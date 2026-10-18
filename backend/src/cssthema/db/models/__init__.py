"""Alle modellen, zodat `Base.metadata` compleet is voor Alembic."""

from cssthema.db.models.api_key import ApiKey
from cssthema.db.models.asset import Asset
from cssthema.db.models.audit import AuditLog
from cssthema.db.models.host import HostBinding
from cssthema.db.models.job import Job
from cssthema.db.models.palette import Palette
from cssthema.db.models.service import Service
from cssthema.db.models.setting import Setting
from cssthema.db.models.snapshot import DomSnapshot, SnapshotSelector
from cssthema.db.models.theme import Theme, ThemeSlugRedirect, ThemeVersion
from cssthema.db.models.user import User

__all__ = [
    "ApiKey",
    "Asset",
    "AuditLog",
    "DomSnapshot",
    "HostBinding",
    "Job",
    "Palette",
    "Service",
    "Setting",
    "SnapshotSelector",
    "Theme",
    "ThemeSlugRedirect",
    "ThemeVersion",
    "User",
]
