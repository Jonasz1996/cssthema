from cssthema.config import Settings
from cssthema.main import create_app

EXPECTED = {
    "themes_list",
    "themes_create",
    "themes_get",
    "themes_update",
    "themes_delete",
    "themes_restore",
    "themes_get_draft",
    "themes_update_draft",
    "themes_reset_draft",
    "themes_lint",
    "themes_publish",
    "themes_rollback",
    "themes_duplicate",
    "themes_list_versions",
    "themes_get_version",
    "themes_diff",
    "themes_export",
    "themes_import",
    "themes_list_local_files",
    "themes_import_local_files",
    "palettes_list",
    "palettes_get",
    "dashboard_get",
    "public_css",
    "public_theme_css",
}


def test_operation_ids(settings: Settings) -> None:
    schema = create_app(settings).openapi()
    operation_ids = [
        operation["operationId"] for path in schema["paths"].values() for operation in path.values()
    ]
    assert len(operation_ids) == len(set(operation_ids))
    assert set(operation_ids) >= EXPECTED


def test_route_order(settings: Settings) -> None:
    """Statische paden vóór `/{theme_id}`, en de publieke `/{ref}.css` helemaal achteraan."""
    paths = list(create_app(settings).openapi()["paths"])
    by_id = paths.index("/api/v1/themes/{theme_id}")
    for static in ("/api/v1/themes/import", "/api/v1/themes/local-files"):
        assert paths.index(static) < by_id
    assert paths[-2:] == ["/{ref}.css", "/themes/{ref}.css"]


def test_mutations_document_if_match(settings: Settings) -> None:
    schema = create_app(settings).openapi()
    put = schema["paths"]["/api/v1/themes/{theme_id}/draft"]["put"]
    headers = [p["name"] for p in put["parameters"] if p["in"] == "header"]
    assert headers == ["If-Match"]
    assert "412" in put["responses"]
    assert "428" in put["responses"]
