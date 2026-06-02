from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class SafetyEventResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    case_id: uuid.UUID
    user_id: uuid.UUID
    user_email: str
    user_full_name: str
    event_type: str
    severity: str
    action_taken: str
    detected_terms: list[str]
    message_turn: int
    note: str
    created_at: datetime
