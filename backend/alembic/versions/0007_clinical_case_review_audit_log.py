"""add clinical case review audit log

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-02 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clinical_case_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reviewer_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("prior_review_status", sa.String(length=50), nullable=False),
        sa.Column("resulting_review_status", sa.String(length=50), nullable=False),
        sa.Column("confirmations", sa.JSON(), nullable=False),
        sa.Column("source_snapshot", sa.JSON(), nullable=False),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["case_id"], ["clinical_cases.id"]),
        sa.ForeignKeyConstraint(["reviewer_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_clinical_case_reviews_case_id"),
        "clinical_case_reviews",
        ["case_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_clinical_case_reviews_reviewer_user_id"),
        "clinical_case_reviews",
        ["reviewer_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_clinical_case_reviews_reviewer_user_id"),
        table_name="clinical_case_reviews",
    )
    op.drop_index(
        op.f("ix_clinical_case_reviews_case_id"),
        table_name="clinical_case_reviews",
    )
    op.drop_table("clinical_case_reviews")
