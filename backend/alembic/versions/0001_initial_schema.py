"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-21 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clinical_cases",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("specialty", sa.String(length=100), nullable=False),
        sa.Column("difficulty", sa.String(length=50), nullable=False),
        sa.Column("chief_complaint", sa.Text(), nullable=False),
        sa.Column("patient_demographics", sa.JSON(), nullable=False),
        sa.Column("history_of_present_illness", sa.Text(), nullable=False),
        sa.Column("past_medical_history", sa.Text(), nullable=False),
        sa.Column("medications", sa.JSON(), nullable=False),
        sa.Column("physical_exam", sa.JSON(), nullable=False),
        sa.Column("initial_labs", sa.JSON(), nullable=False),
        sa.Column("diagnosis", sa.String(length=500), nullable=False),
        sa.Column("key_teaching_points", sa.JSON(), nullable=False),
        sa.Column("cognitive_traps", sa.JSON(), nullable=False),
        sa.Column("coach_guidance", sa.Text(), nullable=False),
        sa.Column("times_used", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("training_level", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)

    op.create_table(
        "coaching_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("final_reasoning_score", sa.Float(), nullable=True),
        sa.Column("reasoning_trajectory", sa.JSON(), nullable=False),
        sa.Column("reasoning_map", sa.JSON(), nullable=False),
        sa.Column("bias_summary", sa.JSON(), nullable=False),
        sa.Column("total_input_tokens", sa.Integer(), nullable=False),
        sa.Column("total_output_tokens", sa.Integer(), nullable=False),
        sa.Column("total_thinking_tokens", sa.Integer(), nullable=False),
        sa.Column("coach_notes", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["case_id"], ["clinical_cases.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_coaching_sessions_case_id"), "coaching_sessions", ["case_id"], unique=False)
    op.create_index(op.f("ix_coaching_sessions_user_id"), "coaching_sessions", ["user_id"], unique=False)

    op.create_table(
        "bias_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bias_type", sa.String(length=100), nullable=False),
        sa.Column("severity", sa.String(length=50), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("message_turn", sa.Integer(), nullable=False),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["coaching_sessions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_bias_events_session_id"), "bias_events", ["session_id"], unique=False)
    op.create_index(op.f("ix_bias_events_user_id"), "bias_events", ["user_id"], unique=False)

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("thinking_content", sa.Text(), nullable=True),
        sa.Column("reasoning_score", sa.Float(), nullable=True),
        sa.Column("reasoning_analysis", sa.JSON(), nullable=True),
        sa.Column("biases_detected", sa.JSON(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("thinking_tokens", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["coaching_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_messages_session_id"), "messages", ["session_id"], unique=False)

    op.create_table(
        "token_usages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("operation", sa.String(length=100), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("thinking_tokens", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["coaching_sessions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_token_usages_session_id"), "token_usages", ["session_id"], unique=False)
    op.create_index(op.f("ix_token_usages_user_id"), "token_usages", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_token_usages_user_id"), table_name="token_usages")
    op.drop_index(op.f("ix_token_usages_session_id"), table_name="token_usages")
    op.drop_table("token_usages")
    op.drop_index(op.f("ix_messages_session_id"), table_name="messages")
    op.drop_table("messages")
    op.drop_index(op.f("ix_bias_events_user_id"), table_name="bias_events")
    op.drop_index(op.f("ix_bias_events_session_id"), table_name="bias_events")
    op.drop_table("bias_events")
    op.drop_index(op.f("ix_coaching_sessions_user_id"), table_name="coaching_sessions")
    op.drop_index(op.f("ix_coaching_sessions_case_id"), table_name="coaching_sessions")
    op.drop_table("coaching_sessions")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
    op.drop_table("clinical_cases")
