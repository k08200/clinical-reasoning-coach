from __future__ import annotations

import pytest

from app.config import Settings, validate_runtime_settings


def test_validate_runtime_settings_accepts_default_dev_config():
    validate_runtime_settings(Settings())


def test_validate_runtime_settings_rejects_unknown_provider():
    with pytest.raises(RuntimeError, match="LLM_PROVIDER"):
        validate_runtime_settings(Settings(llm_provider="unknown"))


def test_validate_runtime_settings_rejects_claude_without_api_key():
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        validate_runtime_settings(Settings(llm_provider="claude", anthropic_api_key=""))


def test_validate_runtime_settings_rejects_default_secret_in_production():
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        validate_runtime_settings(Settings(app_environment="production"))


def test_validate_runtime_settings_rejects_auto_create_tables_in_production():
    with pytest.raises(RuntimeError, match="DATABASE_AUTO_CREATE_TABLES"):
        validate_runtime_settings(
            Settings(
                app_environment="production",
                secret_key="replace-with-a-long-random-secret",
            )
        )


def test_validate_runtime_settings_accepts_production_with_custom_secret():
    validate_runtime_settings(
        Settings(
            app_environment="production",
            secret_key="replace-with-a-long-random-secret",
            database_auto_create_tables=False,
        )
    )


def test_settings_reads_app_env_alias(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "production")

    settings = Settings(
        secret_key="replace-with-a-long-random-secret",
        database_auto_create_tables=False,
    )

    assert settings.app_environment == "production"


def test_settings_reads_database_auto_create_tables_alias(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATABASE_AUTO_CREATE_TABLES", "false")

    settings = Settings()

    assert settings.database_auto_create_tables is False
