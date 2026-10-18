"""fase 1: slug-redirects, ingebouwde paletten en de ontwikkelgebruiker

- tabel `theme_slug_redirects`: oude slug → thema, voor de 301 na een slug-wijziging;
- seed van de ingebouwde paletten (`is_builtin = true`, vaste UUID's). De waarden zijn
  bewust gekopieerd uit `cssthema.domain.palettes.builtin` en niet geïmporteerd, zodat
  deze migratie stabiel blijft; tests/unit/test_migrations.py bewaakt dat ze gelijk zijn;
- seed van de ontwikkelgebruiker (fase 1 heeft nog geen login, docs/07 § 4).

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-05 17:00:00.000000
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEV_USER_ID = "00000000-0000-7000-8000-000000000001"
DEV_USER_SUBJECT = "local:beheerder"
DEV_USER_NAME = "Beheerder"

_MONO = 'ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace'
_SANS = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
_CODE = '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace'

# (id, slug, naam, tokens) — volgorde van de tokens zoals docs/03 § 4.8.
PALETTES: tuple[tuple[str, str, str, dict[str, str]], ...] = (
    (
        "00000000-0000-7000-8000-000000000101",
        "terminal",
        "Terminal",
        {
            "bg": "#141414",
            "surface": "#1e1e1e",
            "fg": "#dddddd",
            "muted": "#999999",
            "accent": "#aaaaaa",
            "accent-fg": "#000000",
            "success": "#8fd6a4",
            "warning": "#e6b56b",
            "danger": "#e58b8b",
            "border": "#333333",
            "radius": "10px",
            "font-sans": _MONO,
            "font-mono": _MONO,
        },
    ),
    (
        "00000000-0000-7000-8000-000000000102",
        "nord",
        "Nord",
        {
            "bg": "#2e3440",
            "surface": "#3b4252",
            "fg": "#eceff4",
            "muted": "#d8dee9",
            "accent": "#88c0d0",
            "accent-fg": "#2e3440",
            "success": "#a3be8c",
            "warning": "#ebcb8b",
            "danger": "#bf616a",
            "border": "#4c566a",
            "radius": "6px",
            "font-sans": _SANS,
            "font-mono": _CODE,
        },
    ),
    (
        "00000000-0000-7000-8000-000000000103",
        "dracula",
        "Dracula",
        {
            "bg": "#282a36",
            "surface": "#343746",
            "fg": "#f8f8f2",
            "muted": "#6272a4",
            "accent": "#bd93f9",
            "accent-fg": "#282a36",
            "success": "#50fa7b",
            "warning": "#f1fa8c",
            "danger": "#ff5555",
            "border": "#44475a",
            "radius": "6px",
            "font-sans": _SANS,
            "font-mono": _CODE,
        },
    ),
    (
        "00000000-0000-7000-8000-000000000104",
        "catppuccin-mocha",
        "Catppuccin Mocha",
        {
            "bg": "#1e1e2e",
            "surface": "#313244",
            "fg": "#cdd6f4",
            "muted": "#a6adc8",
            "accent": "#cba6f7",
            "accent-fg": "#11111b",
            "success": "#a6e3a1",
            "warning": "#f9e2af",
            "danger": "#f38ba8",
            "border": "#45475a",
            "radius": "8px",
            "font-sans": _SANS,
            "font-mono": _CODE,
        },
    ),
    (
        "00000000-0000-7000-8000-000000000105",
        "gruvbox-dark",
        "Gruvbox Dark",
        {
            "bg": "#282828",
            "surface": "#3c3836",
            "fg": "#ebdbb2",
            "muted": "#a89984",
            "accent": "#fe8019",
            "accent-fg": "#282828",
            "success": "#b8bb26",
            "warning": "#fabd2f",
            "danger": "#fb4934",
            "border": "#504945",
            "radius": "4px",
            "font-sans": _SANS,
            "font-mono": _CODE,
        },
    ),
    (
        "00000000-0000-7000-8000-000000000106",
        "solarized-dark",
        "Solarized Dark",
        {
            "bg": "#002b36",
            "surface": "#073642",
            "fg": "#93a1a1",
            "muted": "#657b83",
            "accent": "#268bd2",
            "accent-fg": "#fdf6e3",
            "success": "#859900",
            "warning": "#b58900",
            "danger": "#dc322f",
            "border": "#586e75",
            "radius": "4px",
            "font-sans": _SANS,
            "font-mono": _CODE,
        },
    ),
    (
        "00000000-0000-7000-8000-000000000107",
        "tokyo-night",
        "Tokyo Night",
        {
            "bg": "#1a1b26",
            "surface": "#24283b",
            "fg": "#c0caf5",
            "muted": "#9aa5ce",
            "accent": "#7aa2f7",
            "accent-fg": "#1a1b26",
            "success": "#9ece6a",
            "warning": "#e0af68",
            "danger": "#f7768e",
            "border": "#3b4261",
            "radius": "6px",
            "font-sans": _SANS,
            "font-mono": _CODE,
        },
    ),
)


def upgrade() -> None:
    op.create_table(
        "theme_slug_redirects",
        sa.Column("old_slug", sa.String(length=64), nullable=False),
        sa.Column("theme_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["theme_id"],
            ["themes.id"],
            name=op.f("fk_theme_slug_redirects_theme_id_themes"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("old_slug", name=op.f("pk_theme_slug_redirects")),
    )
    op.create_index(
        "ix_theme_slug_redirects_theme_id", "theme_slug_redirects", ["theme_id"], unique=False
    )

    # ON CONFLICT: na een downgrade die een palet of de gebruiker moest laten staan
    # (omdat er nog naar verwezen wordt), werkt een nieuwe upgrade gewoon.
    for palette_id, slug, name, tokens in PALETTES:
        op.execute(
            sa.text(
                "INSERT INTO palettes (id, slug, name, tokens, is_builtin) "
                "VALUES (CAST(:id AS uuid), :slug, :name, CAST(:tokens AS jsonb), true) "
                "ON CONFLICT DO NOTHING"
            ).bindparams(id=palette_id, slug=slug, name=name, tokens=json.dumps(tokens))
        )
    op.execute(
        sa.text(
            "INSERT INTO users (id, oidc_subject, display_name, role, role_override, is_active) "
            "VALUES (CAST(:id AS uuid), :subject, :name, 'admin', false, true) "
            "ON CONFLICT DO NOTHING"
        ).bindparams(id=DEV_USER_ID, subject=DEV_USER_SUBJECT, name=DEV_USER_NAME)
    )


def _delete_if_unreferenced(table: str, row_id: str) -> None:
    # Een palet in een versie of een gebruiker in de audit-log kan niet weg (FK); dan
    # blijft de rij staan in plaats van dat de hele downgrade faalt. `table` en `row_id`
    # zijn constanten uit deze migratie (een DO-blok kent geen bind-parameters).
    sql = f"""
DO $$
BEGIN
    DELETE FROM {table} WHERE id = '{row_id}';
EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'cssthema: {table} {row_id} blijft staan (nog in gebruik)';
END
$$
"""  # noqa: S608
    op.execute(sql)


def downgrade() -> None:
    _delete_if_unreferenced("users", DEV_USER_ID)
    for palette_id, *_ in PALETTES:
        _delete_if_unreferenced("palettes", palette_id)
    op.drop_index("ix_theme_slug_redirects_theme_id", table_name="theme_slug_redirects")
    op.drop_table("theme_slug_redirects")
