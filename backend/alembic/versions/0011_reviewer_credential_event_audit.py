"""add reviewer credential event audit log

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-15 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reviewer_credential_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reviewer_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("resulting_verification_status", sa.String(length=50), nullable=False),
        sa.Column("practice_scope", sa.String(length=200), nullable=True),
        sa.Column("verification_note", sa.Text(), nullable=False),
        sa.Column("actioned_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["reviewer_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["actioned_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_reviewer_credential_events_reviewer_user_id"),
        "reviewer_credential_events",
        ["reviewer_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_reviewer_credential_events_actioned_by_user_id"),
        "reviewer_credential_events",
        ["actioned_by_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_reviewer_credential_events_actioned_by_user_id"),
        table_name="reviewer_credential_events",
    )
    op.drop_index(
        op.f("ix_reviewer_credential_events_reviewer_user_id"),
        table_name="reviewer_credential_events",
    )
    op.drop_table("reviewer_credential_events")
