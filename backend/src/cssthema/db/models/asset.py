from sqlalchemy import BigInteger, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from cssthema.db.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin


class Asset(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Blob in object storage, content-addressed op SHA-256."""

    __tablename__ = "assets"

    storage_key: Mapped[str] = mapped_column(String(512), unique=True)
    content_type: Mapped[str] = mapped_column(String(127))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
