import uuid
from typing import Any

from sqlalchemy import ForeignKey, Index, Integer, LargeBinary, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cssthema.db.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin
from cssthema.db.models._types import pg_enum
from cssthema.db.models.enums import PageKind, SelectorKind, SnapshotOrigin


class DomSnapshot(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Vastgelegde, gerenderde DOM van één pagina; de HTML zelf staat in storage."""

    __tablename__ = "dom_snapshots"
    __table_args__ = (
        Index("ix_dom_snapshots_latest", "service_id", "page_kind", text("created_at DESC")),
    )

    service_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"))
    page_kind: Mapped[PageKind] = mapped_column(pg_enum(PageKind, "page_kind"))
    url: Mapped[str] = mapped_column(String(2048))
    final_url: Mapped[str | None] = mapped_column(String(2048))
    http_status: Mapped[int | None]
    origin: Mapped[SnapshotOrigin] = mapped_column(pg_enum(SnapshotOrigin, "snapshot_origin"))
    document_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL")
    )
    html_sha256: Mapped[bytes | None] = mapped_column(LargeBinary(32))
    title: Mapped[str | None] = mapped_column(String(500))
    css_variables: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    components: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    framework_hints: Mapped[list[str]] = mapped_column(JSONB, default=list)
    stylesheets: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    colors: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    class_count: Mapped[int] = mapped_column(Integer, default=0)
    id_count: Mapped[int] = mapped_column(Integer, default=0)
    has_shadow_dom: Mapped[bool] = mapped_column(default=False)
    job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"))


class SnapshotSelector(Base):
    """Genormaliseerde classes/IDs/variabelen voor autocomplete en health checks."""

    __tablename__ = "snapshot_selectors"
    __table_args__ = (
        Index(
            "ix_snapshot_selectors_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
    )

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dom_snapshots.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[SelectorKind] = mapped_column(
        pg_enum(SelectorKind, "selector_kind"), primary_key=True
    )
    name: Mapped[str] = mapped_column(String(512), primary_key=True)
    occurrences: Mapped[int] = mapped_column(Integer, default=1)
    in_shadow_dom: Mapped[bool] = mapped_column(default=False)
