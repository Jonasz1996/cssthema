import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, Integer, SmallInteger, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cssthema.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from cssthema.db.models._types import pg_enum
from cssthema.db.models.enums import JobStatus, JobType


class Job(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Asynchrone taak die de UI kan volgen (status, voortgang, resultaat)."""

    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_status_created", "status", "created_at"),
        Index("ix_jobs_created_by", "created_by", "created_at"),
    )

    type: Mapped[JobType] = mapped_column(pg_enum(JobType, "job_type"))
    status: Mapped[JobStatus] = mapped_column(
        pg_enum(JobStatus, "job_status"), default=JobStatus.QUEUED
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    progress: Mapped[int] = mapped_column(SmallInteger, default=0)
    message: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
