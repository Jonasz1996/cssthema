import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from cssthema.db.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin
from cssthema.db.models._types import pg_enum
from cssthema.db.models.enums import ThemeStatus, VersionSource

if TYPE_CHECKING:
    from cssthema.db.models.palette import Palette
    from cssthema.db.models.service import Service

SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$"


class Theme(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    """CSS-thema met publieke slug, werkende draft en lineaire versiegeschiedenis."""

    __tablename__ = "themes"
    __table_args__ = (
        Index(
            "uq_themes_slug_active",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_themes_service_active", "service_id", postgresql_where=text("deleted_at IS NULL")
        ),
        CheckConstraint(f"slug ~ '{SLUG_PATTERN}'", name="slug_format"),
    )

    slug: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("services.id", ondelete="SET NULL")
    )
    palette_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("palettes.id", ondelete="SET NULL")
    )
    status: Mapped[ThemeStatus] = mapped_column(
        pg_enum(ThemeStatus, "theme_status"), default=ThemeStatus.DRAFT
    )
    draft_css: Mapped[str] = mapped_column(Text, default="")
    draft_updated_at: Mapped[datetime | None]
    draft_updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    published_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "theme_versions.id",
            use_alter=True,
            name="fk_themes_published_version_id",
            ondelete="SET NULL",
        )
    )
    latest_version_number: Mapped[int] = mapped_column(Integer, default=0)
    lock_version: Mapped[int] = mapped_column(Integer, default=1)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))

    service: Mapped["Service | None"] = relationship(back_populates="themes", lazy="raise")
    palette: Mapped["Palette | None"] = relationship(lazy="raise")
    versions: Mapped[list["ThemeVersion"]] = relationship(
        back_populates="theme",
        foreign_keys="ThemeVersion.theme_id",
        order_by="ThemeVersion.version_number.desc()",
        lazy="raise",
    )
    published_version: Mapped["ThemeVersion | None"] = relationship(
        foreign_keys=[published_version_id], post_update=True, lazy="raise"
    )

    __mapper_args__ = {"version_id_col": lock_version}  # noqa: RUF012


class ThemeVersion(UUIDPrimaryKeyMixin, Base):
    """Onveranderlijke snapshot van een thema (een DB-trigger weigert UPDATE)."""

    __tablename__ = "theme_versions"
    __table_args__ = (
        UniqueConstraint("theme_id", "version_number", name="uq_theme_versions_theme_version"),
    )

    theme_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("themes.id", ondelete="CASCADE"))
    version_number: Mapped[int] = mapped_column(Integer)
    css_source: Mapped[str] = mapped_column(Text)
    css_compiled: Mapped[str] = mapped_column(Text)
    sha256: Mapped[bytes] = mapped_column(LargeBinary(32))
    size_bytes: Mapped[int] = mapped_column(Integer)
    source: Mapped[VersionSource] = mapped_column(pg_enum(VersionSource, "version_source"))
    # Geen ON DELETE SET NULL: dat zou een UPDATE zijn, en versies zijn onveranderlijk.
    source_version_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("theme_versions.id"))
    palette_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("palettes.id", ondelete="SET NULL")
    )
    palette_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    message: Mapped[str | None] = mapped_column(String(500))
    lint_warnings: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    theme: Mapped[Theme] = relationship(
        back_populates="versions", foreign_keys=[theme_id], lazy="raise"
    )
