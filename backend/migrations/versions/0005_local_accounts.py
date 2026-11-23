"""users: lokale accounts met wachtwoord, MFA (TOTP) en accountreset (AUTH_MODE=lokaal)

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-23 19:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
    op.add_column(
        "users",
        sa.Column("must_change_password", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "users", sa.Column("password_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("users", sa.Column("totp_secret", sa.String(64), nullable=True))
    op.add_column("users", sa.Column("totp_pending_secret", sa.String(64), nullable=True))
    op.add_column("users", sa.Column("totp_last_step", sa.Integer(), nullable=True))
    op.add_column(
        "users",
        sa.Column("session_version", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "users",
        sa.Column("failed_logins", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for column in (
        "locked_until",
        "failed_logins",
        "session_version",
        "totp_last_step",
        "totp_pending_secret",
        "totp_secret",
        "password_expires_at",
        "must_change_password",
        "password_hash",
    ):
        op.drop_column("users", column)
