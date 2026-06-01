"""add clinical case source metadata

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-01 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "clinical_cases",
        sa.Column(
            "clinical_sources",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )
    op.add_column(
        "clinical_cases",
        sa.Column(
            "review_status",
            sa.String(length=50),
            nullable=False,
            server_default="educational_draft",
        ),
    )
    op.add_column(
        "clinical_cases",
        sa.Column("last_reviewed_at", sa.String(length=50), nullable=True),
    )

    op.alter_column("clinical_cases", "clinical_sources", server_default=None)
    op.alter_column("clinical_cases", "review_status", server_default=None)


def downgrade() -> None:
    op.drop_column("clinical_cases", "last_reviewed_at")
    op.drop_column("clinical_cases", "review_status")
    op.drop_column("clinical_cases", "clinical_sources")
