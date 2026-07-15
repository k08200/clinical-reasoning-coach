"""version educational use consent

Revision ID: 0012
Revises: 0011
Create Date: 2026-07-15 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

LEGACY_EDUCATIONAL_USE_CONSENT_VERSION = "legacy-unversioned"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "accepted_educational_use_version",
            sa.String(length=50),
            server_default=LEGACY_EDUCATIONAL_USE_CONSENT_VERSION,
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "accepted_educational_use_version")
