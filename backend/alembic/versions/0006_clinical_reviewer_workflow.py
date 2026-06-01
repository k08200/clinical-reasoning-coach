"""add clinical reviewer workflow

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-02 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "role",
            sa.String(length=50),
            server_default="learner",
            nullable=False,
        ),
    )
    op.add_column(
        "clinical_cases",
        sa.Column("reviewed_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "clinical_cases",
        sa.Column("review_notes", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        "fk_clinical_cases_reviewed_by_user_id_users",
        "clinical_cases",
        "users",
        ["reviewed_by_user_id"],
        ["id"],
    )
    op.alter_column("users", "role", server_default=None)


def downgrade() -> None:
    op.drop_constraint(
        "fk_clinical_cases_reviewed_by_user_id_users",
        "clinical_cases",
        type_="foreignkey",
    )
    op.drop_column("clinical_cases", "review_notes")
    op.drop_column("clinical_cases", "reviewed_by_user_id")
    op.drop_column("users", "role")
