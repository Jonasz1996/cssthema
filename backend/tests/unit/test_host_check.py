"""De HTTP-kant van de host-controle (services/host_health.check_host), zonder netwerk."""

import httpx

from cssthema.services.host_health import check_host

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
