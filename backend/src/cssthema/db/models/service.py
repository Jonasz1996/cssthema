import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ARRAY, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from cssthema.db.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin
from cssthema.db.models._types import pg_enum
from cssthema.db.models.enums import ServiceSource, ServiceType

if TYPE_CHECKING:
    from cssthema.db.models.theme import Theme


class Service(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    """Een doel-applicatie, bv. Proxmox op https://pve.domain.be."""

    __tablename__ = "services"
    __table_args__ = (
        Index(
            "uq_services_slug_active",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_services_base_url_active",
            "base_url",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_services_tags", "tags", postgresql_using="gin"),
    )

    slug: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[ServiceType] = mapped_column(
        pg_enum(ServiceType, "service_type"), default=ServiceType.GENERIC
    )
    base_url: Mapped[str] = mapped_column(String(2048))
    login_url: Mapped[str | None] = mapped_column(String(2048))
    favicon_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL")
    )
    source: Mapped[ServiceSource] = mapped_column(
        pg_enum(ServiceSource, "service_source"), default=ServiceSource.MANUAL
    )
    npm_proxy_host_id: Mapped[int | None]
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    last_crawled_at: Mapped[datetime | None]

    themes: Mapped[list["Theme"]] = relationship(back_populates="service", lazy="raise")
