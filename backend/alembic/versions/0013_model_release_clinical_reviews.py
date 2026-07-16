"""model release clinical reviews

Revision ID: 0013
Revises: 0012
Create Date: 2026-07-17 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "model_release_clinical_reviews",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=255), nullable=False),
        sa.Column("evaluation_sha256", sa.String(length=64), nullable=False),
        sa.Column("reviewer_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("practice_scope", sa.String(length=200), nullable=False),
        sa.Column("confirmations", sa.JSON(), nullable=False),
        sa.Column("review_notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.UniqueConstraint(
            "provider", "model", "evaluation_sha256", "reviewer_user_id",
            name="uq_model_release_clinical_review_reviewer",
        ),
    )
    op.create_index("ix_model_release_clinical_reviews_provider", "model_release_clinical_reviews", ["provider"])
    op.create_index("ix_model_release_clinical_reviews_evaluation_sha256", "model_release_clinical_reviews", ["evaluation_sha256"])
    op.create_index("ix_model_release_clinical_reviews_reviewer_user_id", "model_release_clinical_reviews", ["reviewer_user_id"])


def downgrade() -> None:
    op.drop_table("model_release_clinical_reviews")
