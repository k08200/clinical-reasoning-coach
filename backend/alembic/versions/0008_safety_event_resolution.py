"""add safety event resolution

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-02 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "safety_events",
        sa.Column("status", sa.String(length=50), server_default="open", nullable=False),
    )
    op.add_column("safety_events", sa.Column("resolution_note", sa.Text(), nullable=True))
    op.add_column(
        "safety_events",
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "safety_events",
        sa.Column("resolved_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_safety_events_resolved_by_user_id_users",
        "safety_events",
        "users",
        ["resolved_by_user_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_safety_events_resolved_by_user_id_users",
        "safety_events",
        type_="foreignkey",
    )
    op.drop_column("safety_events", "resolved_by_user_id")
    op.drop_column("safety_events", "resolved_at")
    op.drop_column("safety_events", "resolution_note")
    op.drop_column("safety_events", "status")
