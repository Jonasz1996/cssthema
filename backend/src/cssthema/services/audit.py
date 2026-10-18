"""Audit-log: elke muterende actie schrijft een rij in dezelfde transactie (docs/02 § 3.7).

`changes` blijft compact (`{"version": 8}`, `{"slug": [oud, nieuw]}`): nooit volledige
CSS of geheimen (docs/03 § 4.13). Autosaves van de draft worden niet gelogd.
"""

import uuid
from typing import Any

from cssthema.db.models import AuditLog
from cssthema.services.context import ServiceContext


def record(
    ctx: ServiceContext,
    action: str,
    *,
    entity_id: uuid.UUID | None,
    changes: dict[str, Any] | None = None,
    entity_type: str = "theme",
) -> None:
    actor = ctx.actor
    ctx.session.add(
        AuditLog(
            actor_user_id=actor.user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            ip=actor.ip,
            user_agent=actor.user_agent,
            request_id=actor.request_id,
            changes=changes or {},
        )
    )
