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
            llm_provider="ollama",
            rate_limit_enabled=True,
            clinical_review_minimum_distinct_reviewers=2,
        )
    )


def test_validate_runtime_settings_rejects_mock_provider_in_production():
    with pytest.raises(RuntimeError, match="does not allow LLM_PROVIDER=mock"):
        validate_runtime_settings(
            Settings(
                app_environment="production",
                secret_key="replace-with-a-long-random-secret",
                database_auto_create_tables=False,
                llm_provider="mock",
            )
        )


def test_validate_runtime_settings_requires_rate_limiting_in_production():
    with pytest.raises(RuntimeError, match="RATE_LIMIT_ENABLED"):
        validate_runtime_settings(
            Settings(
                app_environment="production",
                secret_key="replace-with-a-long-random-secret",
                database_auto_create_tables=False,
                llm_provider="ollama",
            )
        )


def test_validate_runtime_settings_requires_independent_clinical_reviews_in_production():
    with pytest.raises(RuntimeError, match="CLINICAL_REVIEW_MINIMUM_DISTINCT_REVIEWERS"):
        validate_runtime_settings(
            Settings(
                app_environment="production",
                secret_key="replace-with-a-long-random-secret",
                database_auto_create_tables=False,
                llm_provider="ollama",
                rate_limit_enabled=True,
                clinical_review_minimum_distinct_reviewers=1,
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


def test_settings_reads_admin_bootstrap_token_alias(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ADMIN_BOOTSTRAP_TOKEN", "setup-token")

    settings = Settings()

    assert settings.admin_bootstrap_token == "setup-token"


def test_settings_rejects_non_ip_trusted_proxy(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TRUSTED_PROXY_IPS", '["proxy.internal"]')

    with pytest.raises(ValueError, match="TRUSTED_PROXY_IPS"):
        Settings()
