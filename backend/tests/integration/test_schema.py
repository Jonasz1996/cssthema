import hashlib

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cssthema.db.models import ApiKey, AuditLog, Palette, Theme, ThemeVersion, User
from cssthema.db.models.enums import ApiKeyScope, ThemeStatus, UserRole, VersionSource


async def _user(session: AsyncSession) -> User:
    user = User(oidc_subject="local:test", display_name="Test", role=UserRole.ADMIN)
    session.add(user)
    await session.flush()
    return user


async def _theme_with_version(session: AsyncSession) -> tuple[Theme, ThemeVersion]:
    user = await _user(session)
    theme = Theme(slug="proxmox", name="Proxmox", created_by=user.id)
    session.add(theme)
    await session.flush()
    css = ".x-panel{color:red}"
    version = ThemeVersion(
        theme_id=theme.id,
        version_number=1,
        css_source=css,
        css_compiled=css,
        sha256=hashlib.sha256(css.encode()).digest(),
        size_bytes=len(css),
        source=VersionSource.MANUAL,
        created_by=user.id,
    )
    session.add(version)
    await session.flush()
    theme.published_version_id = version.id
    theme.status = ThemeStatus.PUBLISHED
    await session.flush()
    return theme, version


async def test_publish_pointer_and_lock_version(session: AsyncSession) -> None:
    theme, _ = await _theme_with_version(session)
    assert theme.lock_version == 2  # verhoogd door de publicatie-update
    row = (
        await session.execute(
            select(ThemeVersion.version_number)
            .join(Theme, Theme.published_version_id == ThemeVersion.id)
            .where(Theme.slug == "proxmox", Theme.deleted_at.is_(None))
        )
    ).scalar_one()
    assert row == 1


async def test_theme_versions_are_immutable(session: AsyncSession) -> None:
    _, version = await _theme_with_version(session)
    with pytest.raises(DBAPIError, match="immutable"):
        async with session.begin_nested():
            await session.execute(
                text("UPDATE theme_versions SET message = 'x' WHERE id = :id"),
                {"id": version.id},
            )


async def test_hard_delete_theme_cascades_versions(session: AsyncSession) -> None:
    theme, _ = await _theme_with_version(session)
    await session.execute(text("DELETE FROM themes WHERE id = :id"), {"id": theme.id})
    remaining = await session.execute(
        text("SELECT count(*) FROM theme_versions WHERE theme_id = :id"), {"id": theme.id}
    )
    assert remaining.scalar_one() == 0


async def test_audit_log_is_append_only(session: AsyncSession) -> None:
    user = await _user(session)
    entry = AuditLog(actor_user_id=user.id, action="theme.create", changes={})
    session.add(entry)
    await session.flush()
    for statement in ("UPDATE audit_logs SET action = 'x'", "DELETE FROM audit_logs"):
        with pytest.raises(DBAPIError, match="immutable"):
            async with session.begin_nested():
                await session.execute(text(statement))


async def test_slug_unique_only_among_active_themes(session: AsyncSession) -> None:
    user = await _user(session)
    first = Theme(slug="grafana", name="Grafana", created_by=user.id)
    session.add(first)
    await session.flush()
    with pytest.raises(IntegrityError):
        async with session.begin_nested():
            session.add(Theme(slug="grafana", name="Dubbel", created_by=user.id))
            await session.flush()

    await session.execute(
        text("UPDATE themes SET deleted_at = now() WHERE id = :id"), {"id": first.id}
    )
    session.add(Theme(slug="grafana", name="Opnieuw", created_by=user.id))
    await session.flush()


async def test_slug_format_check(session: AsyncSession) -> None:
    with pytest.raises(IntegrityError, match="ck_themes_slug_format"):
        async with session.begin_nested():
            session.add(Theme(slug="Niet Geldig", name="x"))
            await session.flush()


async def test_orm_delete_theme_lets_database_cascade_versions(session: AsyncSession) -> None:
    theme, version = await _theme_with_version(session)
    await session.delete(theme)
    await session.flush()
    remaining = await session.execute(
        text("SELECT count(*) FROM theme_versions WHERE id = :id"), {"id": version.id}
    )
    assert remaining.scalar_one() == 0


async def test_palette_in_a_version_cannot_be_hard_deleted(session: AsyncSession) -> None:
    user = await _user(session)
    palette = Palette(
        slug="test-schema-palet", name="Testpalet", tokens={"bg": "#2e3440"}, created_by=user.id
    )
    theme = Theme(slug="grafana", name="Grafana", created_by=user.id)
    session.add_all([palette, theme])
    await session.flush()
    css = ":root{}"
    session.add(
        ThemeVersion(
            theme_id=theme.id,
            version_number=1,
            css_source=css,
            css_compiled=css,
            sha256=hashlib.sha256(css.encode()).digest(),
            size_bytes=len(css),
            source=VersionSource.MANUAL,
            palette_id=palette.id,
        )
    )
    await session.flush()
    # Een nette FK-fout (later 409), geen abort door de onveranderlijkheidstrigger.
    with pytest.raises(IntegrityError, match="fk_theme_versions_palette_id_palettes"):
        async with session.begin_nested():
            await session.execute(text("DELETE FROM palettes WHERE id = :id"), {"id": palette.id})


async def test_api_key_scopes_are_checked(session: AsyncSession) -> None:
    user = await _user(session)
    session.add(
        ApiKey(
            user_id=user.id,
            name="ci",
            prefix="ok000001",
            secret_hash=b"\0" * 32,
            scopes=[ApiKeyScope.THEMES_READ, ApiKeyScope.THEMES_PUBLISH],
        )
    )
    await session.flush()
    with pytest.raises(IntegrityError, match="ck_api_keys_scopes_allowed"):
        async with session.begin_nested():
            session.add(
                ApiKey(
                    user_id=user.id,
                    name="fout",
                    prefix="bad00001",
                    secret_hash=b"\0" * 32,
                    scopes=["themes:read", "root:everything"],
                )
            )
            await session.flush()
