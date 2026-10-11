"""hosts: koppeling proxy host -> thema's en scripts voor /host/<hostname>.css|.js

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-11 02:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "host_bindings",
        sa.Column("hostname", sa.String(length=253), nullable=False),
        sa.Column("styles", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("scripts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "hostname = lower(hostname)", name=op.f("ck_host_bindings_hostname_lowercase")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_host_bindings")),
        sa.UniqueConstraint("hostname", name=op.f("uq_host_bindings_hostname")),
    )


def downgrade() -> None:
    op.drop_table("host_bindings")
