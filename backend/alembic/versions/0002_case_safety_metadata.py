"""add clinical case safety metadata

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-01 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "clinical_cases",
        sa.Column(
            "clinical_red_flags",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )
    op.add_column(
        "clinical_cases",
        sa.Column(
            "time_critical_actions",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )
    op.add_column(
        "clinical_cases",
        sa.Column(
            "contraindication_checks",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )

    op.alter_column("clinical_cases", "clinical_red_flags", server_default=None)
    op.alter_column("clinical_cases", "time_critical_actions", server_default=None)
    op.alter_column("clinical_cases", "contraindication_checks", server_default=None)


def downgrade() -> None:
    op.drop_column("clinical_cases", "contraindication_checks")
    op.drop_column("clinical_cases", "time_critical_actions")
    op.drop_column("clinical_cases", "clinical_red_flags")
