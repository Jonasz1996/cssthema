"""De HTTP-kant van de host-controle (services/host_health.check_host), zonder netwerk."""

import gzip

import httpx

from cssthema.services.host_health import check_client, check_host, check_hostnames

BASE = "https://css.jbogaert.be"


def client(handler: httpx.MockTransport) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=handler, follow_redirects=False)


async def test_follows_same_host_redirect_to_the_login_page() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/":
            return httpx.Response(302, headers={"Location": "/login"})
        html = f'<link href="{BASE}/host/{request.url.host}.css">'
        return httpx.Response(200, headers={"Content-Type": "text/html"}, text=html)

    async with client(httpx.MockTransport(handle)) as http:
        result = await check_host(http, "app.jbogaert.be", BASE)
    assert result["code"] == "rule_active"
    assert result["http_status"] == 200


async def test_authentik_redirect_is_login() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"Location": "https://auth.jbogaert.be/flows/x"})

    async with client(httpx.MockTransport(handle)) as http:
        result = await check_host(http, "app.jbogaert.be", BASE)
    assert result["code"] == "login"
    assert result["level"] == "unknown"


async def test_unreachable_and_redirect_loop() -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("geen route")

    async with client(httpx.MockTransport(fail)) as http:
        assert (await check_host(http, "app.jbogaert.be", BASE))["code"] == "unreachable"

    def loop(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"Location": "/weer"})

    async with client(httpx.MockTransport(loop)) as http:
        assert (await check_host(http, "app.jbogaert.be", BASE))["code"] == "http_error"


def gzip_html(html: str) -> httpx.Response:
    return httpx.Response(
        200,
        headers={"Content-Type": "text/html", "Content-Encoding": "gzip"},
        content=gzip.compress(html.encode()),
    )


async def test_checks_like_a_browser() -> None:
    # De regel maakt Accept-Encoding alleen leeg bij een Accept met text/html; een app die
    # comprimeert, moet dat hier dus ook doen (anders ziet de controle wat browsers niet zien).
    seen: list[httpx.Headers] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers)
        return httpx.Response(200, headers={"Content-Type": "text/html"}, text="<html></html>")

    async with check_client(transport=httpx.MockTransport(handle)) as http:
        await check_host(http, "app.jbogaert.be", BASE)
    assert seen[0]["Accept-Encoding"] == "gzip, deflate"
    assert "text/html" in seen[0]["Accept"]


async def test_app_that_compresses_with_the_old_rule_names_the_new_rule() -> None:
    # De app gzipt zodra gzip mag, en sub_filter vindt dan niets; zonder compressie (identity)
    # zet de (oude) regel het thema er wel in.
    seen: list[httpx.Headers] = []
    rule = f'<head><link rel="stylesheet" href="{BASE}/host/app.jbogaert.be.css"></head>'

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers)
        if "gzip" in request.headers.get("Accept-Encoding", ""):
            return gzip_html("<html><head><title>app</title></head></html>")
        return httpx.Response(200, headers={"Content-Type": "text/html"}, text=rule)

    async with check_client(transport=httpx.MockTransport(handle)) as http:
        result = await check_host(http, "app.jbogaert.be", BASE)
    assert result["code"] == "no_rule"
    assert result["level"] == "error"
    assert result["content_encoding"] == "gzip"
    assert "comprimeert" in result["detail"]
    assert "more_set_input_headers" in result["detail"]
    assert [h["Accept-Encoding"] for h in seen] == ["gzip, deflate", "identity"]
    assert seen[1]["Accept"] == seen[0]["Accept"]


async def test_compressed_page_without_any_rule_gets_the_plain_text() -> None:
    # NPM zet `gzip on`: ook een host zonder regel antwoordt gecomprimeerd. Zonder compressie
    # nog steeds geen thema: dan ontbreekt de regel gewoon, de compressie zegt niets.
    calls: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append(request.headers["Accept-Encoding"])
        html = "<html><head><title>app</title></head></html>"
        if "gzip" in request.headers["Accept-Encoding"]:
            return gzip_html(html)
        return httpx.Response(200, headers={"Content-Type": "text/html"}, text=html)

    async with check_client(transport=httpx.MockTransport(handle)) as http:
        result = await check_host(http, "app.jbogaert.be", BASE)
    assert result["code"] == "no_rule"
    assert "comprimeert" not in result["detail"]
    assert "Advanced" in result["detail"]
    assert result["content_encoding"] is None
    assert calls == ["gzip, deflate", "identity"]


async def test_second_request_that_fails_gets_the_plain_text() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.headers["Accept-Encoding"] == "identity":
            raise httpx.ReadTimeout("te traag")
        return gzip_html("<html><head></head></html>")

    async with check_client(transport=httpx.MockTransport(handle)) as http:
        result = await check_host(http, "app.jbogaert.be", BASE)
    assert result["code"] == "no_rule"
    assert "comprimeert" not in result["detail"]


async def test_compressed_page_with_rule_is_ok() -> None:
    # NPM comprimeert zelf ná sub_filter: met de regel in de HTML is gzip in orde, en dan is
    # er geen tweede vraag en geen melding over compressie.
    calls = 0

    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return gzip_html(f'<head><link rel="stylesheet" href="{BASE}/host/app.jbogaert.be.css">')

    async with check_client(transport=httpx.MockTransport(handle)) as http:
        result = await check_host(http, "app.jbogaert.be", BASE)
    assert result["code"] == "rule_active"
    assert result["content_encoding"] is None
    assert calls == 1


async def test_uncompressed_page_without_rule_asks_once() -> None:
    calls = 0

    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, headers={"Content-Type": "text/html"}, text="<html></html>")

    async with check_client(transport=httpx.MockTransport(handle)) as http:
        result = await check_host(http, "app.jbogaert.be", BASE)
    assert result["code"] == "no_rule"
    assert calls == 1


def test_check_hostnames_never_uses_seen_names_or_excluded_hosts() -> None:
    bindings = [("*", True), ("a.be", True), ("uit.be", False), ("css.be", True)]
    services = ["a.be", "dienst.be", "uit.be", "cssthema.be"]
    assert check_hostnames(bindings, services, {"css.be", "cssthema.be"}) == ["a.be", "dienst.be"]
    # Zonder (ingeschakelde) `*` krijgen diensten zonder eigen koppeling niets: niet controleren.
    assert check_hostnames([("*", False), ("a.be", True)], ["dienst.be"], set()) == ["a.be"]
    assert check_hostnames([("a.be", True)], ["dienst.be"], set()) == ["a.be"]
