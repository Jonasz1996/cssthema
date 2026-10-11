"""dom_snapshots.capture_info: gegevens uit de capture-zips van vastleggen.py (D1)

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-11 22:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "dom_snapshots",
        sa.Column(
            "capture_info",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("dom_snapshots", "capture_info")
