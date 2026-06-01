"""add safety events

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-01 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "safety_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("severity", sa.String(length=50), nullable=False),
        sa.Column("action_taken", sa.String(length=100), nullable=False),
        sa.Column("detected_terms", sa.JSON(), nullable=False),
        sa.Column("message_turn", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["session_id"], ["coaching_sessions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_safety_events_session_id"), "safety_events", ["session_id"], unique=False)
    op.create_index(op.f("ix_safety_events_user_id"), "safety_events", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_safety_events_user_id"), table_name="safety_events")
    op.drop_index(op.f("ix_safety_events_session_id"), table_name="safety_events")
    op.drop_table("safety_events")
