"""add reviewer credential verification

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-15 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "reviewer_verification_status",
            sa.String(length=50),
            server_default="not_applicable",
            nullable=False,
        ),
    )
    op.add_column("users", sa.Column("reviewer_practice_scope", sa.String(length=200), nullable=True))
    op.add_column("users", sa.Column("reviewer_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "users",
        sa.Column("reviewer_verified_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_users_reviewer_verified_by_user_id_users",
        "users",
        "users",
        ["reviewer_verified_by_user_id"],
        ["id"],
    )
    op.execute(
        "UPDATE users SET reviewer_verification_status = 'pending' "
        "WHERE role = 'clinician_reviewer'"
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_users_reviewer_verified_by_user_id_users",
        "users",
        type_="foreignkey",
    )
    op.drop_column("users", "reviewer_verified_by_user_id")
    op.drop_column("users", "reviewer_verified_at")
    op.drop_column("users", "reviewer_practice_scope")
    op.drop_column("users", "reviewer_verification_status")
