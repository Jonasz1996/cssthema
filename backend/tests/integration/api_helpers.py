"""Hulpjes voor de API-integratietests (de fixture `api` staat in conftest.py)."""

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine


@dataclass
class Api:
    """Client op een volledige app (lifespan) met een eigen css-files-map."""

    client: AsyncClient
    app: FastAPI
    css_dir: Path
    refresh_calls: list[str] = field(default_factory=list)
    refresh_status: int = 200
    # Eerst deze statussen (één per refresh-call), daarna `refresh_status`.
    refresh_statuses: list[int] = field(default_factory=list)

    async def refreshed(self) -> list[str]:
        """De refresh-calls naar nginx, na de achtergrond-refreshes (`@n`)."""
        await self.app.state.css_delivery.drain()
        return self.refresh_calls

    async def create_theme(self, **payload: Any) -> dict[str, Any]:
        payload.setdefault("name", "Integratietest")
        payload.setdefault("slug", unique_slug())
        response = await self.client.post("/api/v1/themes", json=payload)
        assert response.status_code == 201, response.text
        result: dict[str, Any] = response.json()
        return result

    async def save_draft(self, theme: dict[str, Any], css: str) -> dict[str, Any]:
        response = await self.client.put(
            f"/api/v1/themes/{theme['id']}/draft",
            json={"css": css},
            headers={"If-Match": f'"lv-{theme["lock_version"]}"'},
        )
        assert response.status_code == 200, response.text
        result: dict[str, Any] = response.json()
        theme["lock_version"] = result["lock_version"]
        return result

    async def publish(self, theme: dict[str, Any], message: str | None = None) -> dict[str, Any]:
        response = await self.client.post(
            f"/api/v1/themes/{theme['id']}/publish",
            json={"expected_lock_version": theme["lock_version"], "message": message},
        )
        assert response.status_code == 201, response.text
        theme["lock_version"] = int(response.headers["ETag"].strip('"').removeprefix("lv-"))
        result: dict[str, Any] = response.json()
        return result

    async def published_theme(
        self, css: str = "body { color: red; }", **payload: Any
    ) -> dict[str, Any]:
        theme = await self.create_theme(css=css, **payload)
        await self.publish(theme)
        return theme


def unique_slug(prefix: str = "it") -> str:
    """Integratietests gebruiken unieke `it-…`-slugs; ze worden na elke test opgeruimd."""
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


async def audit_actions(engine: AsyncEngine, theme_id: str) -> list[tuple[str, dict[str, Any]]]:
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT action, changes FROM audit_logs "
                "WHERE entity_type = 'theme' AND entity_id = CAST(:id AS uuid) ORDER BY id"
            ),
            {"id": theme_id},
        )
        return [(row[0], row[1]) for row in result.all()]
