from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path

import pytest

from app.config import (
    MODEL_RELEASE_EVALUATION_SCENARIO_IDS,
    MODEL_RELEASE_EVALUATION_SUITE_VERSION,
    Settings,
    model_release_delivery_policy_sha256,
    model_release_approval_status,
    validate_runtime_settings,
)
from app.services.model_release_evaluation import evaluation_sha256


def _current_ollama_release_approval(tmp_path: Path) -> dict:
    artifact = {
        "suite_version": MODEL_RELEASE_EVALUATION_SUITE_VERSION,
        "provider": "ollama",
        "model": "llama3.2",
        "delivery_policy_sha256": model_release_delivery_policy_sha256("ollama"),
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "passed": True,
        "scenarios": [
            {"id": scenario_id, "passed": True}
            for scenario_id in MODEL_RELEASE_EVALUATION_SCENARIO_IDS
        ],
    }
    artifact["sha256"] = evaluation_sha256(artifact)
    path = tmp_path / "model-release-evaluation.json"
    path.write_text(json.dumps(artifact), encoding="utf-8")
    return {
        "ollama_model": "llama3.2",
        "model_release_approval_id": "clinical-eval-2026-07-001",
        "model_release_approval_provider": "ollama",
        "model_release_approval_model": "llama3.2",
        "model_release_approval_expires_on": date.today() + timedelta(days=90),
        "model_release_evaluation_sha256": artifact["sha256"],
        "model_release_evaluation_artifact_path": str(path),
    }


def _current_curated_release_approval(tmp_path: Path) -> dict:
    provider = "curated"
    model = "curated-question-bank-v1"
    artifact = {
        "suite_version": MODEL_RELEASE_EVALUATION_SUITE_VERSION,
        "provider": provider,
        "model": model,
        "delivery_policy_sha256": model_release_delivery_policy_sha256(provider),
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "passed": True,
        "scenarios": [
            {"id": scenario_id, "passed": True}
            for scenario_id in MODEL_RELEASE_EVALUATION_SCENARIO_IDS
        ],
    }
    artifact["sha256"] = evaluation_sha256(artifact)
    path = tmp_path / "curated-model-release-evaluation.json"
    path.write_text(json.dumps(artifact), encoding="utf-8")
    return {
        "model_release_approval_id": "curated-clinical-eval-2026-07-001",
        "model_release_approval_provider": provider,
        "model_release_approval_model": model,
        "model_release_approval_expires_on": date.today() + timedelta(days=90),
        "model_release_evaluation_sha256": artifact["sha256"],
        "model_release_evaluation_artifact_path": str(path),
    }


def test_validate_runtime_settings_accepts_default_dev_config():
    validate_runtime_settings(Settings())


def test_default_provider_is_the_free_curated_question_bank():
    assert Settings.model_fields["llm_provider"].default == "curated"


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


def test_validate_runtime_settings_accepts_production_with_custom_secret(tmp_path: Path):
    validate_runtime_settings(
        Settings(
            app_environment="production",
            secret_key="replace-with-a-long-random-secret",
            database_auto_create_tables=False,
            llm_provider="ollama",
            rate_limit_enabled=True,
            clinical_review_minimum_distinct_reviewers=2,
            **_current_ollama_release_approval(tmp_path),
        )
    )


def test_validate_runtime_settings_accepts_reviewed_curated_provider(tmp_path: Path):
    validate_runtime_settings(
        Settings(
            app_environment="production",
            secret_key="replace-with-a-long-random-secret",
            database_auto_create_tables=False,
            llm_provider="curated",
            rate_limit_enabled=True,
            clinical_review_minimum_distinct_reviewers=2,
            **_current_curated_release_approval(tmp_path),
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


def test_validate_runtime_settings_requires_current_model_release_approval_in_production():
    with pytest.raises(RuntimeError, match="model release approval"):
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


def test_model_release_approval_rejects_provider_model_drift_and_invalid_expiry(tmp_path: Path):
    settings = Settings(llm_provider="ollama", **_current_ollama_release_approval(tmp_path))
    assert model_release_approval_status(settings)[0] is True

    settings.model_release_approval_provider = "claude"
    assert model_release_approval_status(settings) == (
        False,
        "Model release approval provider does not match the configured provider.",
    )

    settings.model_release_approval_provider = settings.llm_provider
    settings.model_release_approval_model = "different-model"
    assert model_release_approval_status(settings) == (
        False,
        "Model release approval model does not match the configured model.",
    )

    settings.model_release_approval_model = settings.ollama_model
    settings.model_release_approval_expires_on = date.today() - timedelta(days=1)
    assert model_release_approval_status(settings) == (
        False,
        "Model release approval has expired.",
    )

    settings.model_release_approval_expires_on = date.today() + timedelta(days=367)
    assert model_release_approval_status(settings) == (
        False,
        "Model release approval expiry exceeds the maximum validity period.",
    )

    settings.model_release_approval_expires_on = date.today() + timedelta(days=90)
    settings.model_release_evaluation_sha256 = "not-a-sha256"
    assert model_release_approval_status(settings) == (
        False,
        "Model release evaluation hash must be a SHA-256 digest.",
    )


def test_model_release_approval_rejects_failed_or_tampered_evaluation_artifact(
    tmp_path: Path,
):
    approval = _current_ollama_release_approval(tmp_path)
    settings = Settings(llm_provider="ollama", **approval)
    path = Path(settings.model_release_evaluation_artifact_path)
    artifact = json.loads(path.read_text(encoding="utf-8"))
    artifact["passed"] = False
    artifact["sha256"] = evaluation_sha256(artifact)
    settings.model_release_evaluation_sha256 = artifact["sha256"]
    path.write_text(json.dumps(artifact), encoding="utf-8")

    assert model_release_approval_status(settings) == (
        False,
        "Model release evaluation artifact contains failed scenarios.",
    )

    artifact["passed"] = True
    artifact["sha256"] = evaluation_sha256(artifact)
    path.write_text(json.dumps(artifact), encoding="utf-8")
    settings.model_release_evaluation_sha256 = "a" * 64

    assert model_release_approval_status(settings) == (
        False,
        "Model release evaluation artifact hash does not match the configured digest.",
    )


def test_model_release_approval_rejects_incomplete_or_duplicate_safety_scenarios(
    tmp_path: Path,
):
    approval = _current_ollama_release_approval(tmp_path)
    settings = Settings(llm_provider="ollama", **approval)
    path = Path(settings.model_release_evaluation_artifact_path)
    artifact = json.loads(path.read_text(encoding="utf-8"))
    artifact["scenarios"] = artifact["scenarios"][:-1]
    artifact["sha256"] = evaluation_sha256(artifact)
    settings.model_release_evaluation_sha256 = artifact["sha256"]
    path.write_text(json.dumps(artifact), encoding="utf-8")

    assert model_release_approval_status(settings) == (
        False,
        "Model release evaluation artifact does not contain the exact required safety scenarios.",
    )

    artifact["scenarios"].append(dict(artifact["scenarios"][0]))
    artifact["sha256"] = evaluation_sha256(artifact)
    settings.model_release_evaluation_sha256 = artifact["sha256"]
    path.write_text(json.dumps(artifact), encoding="utf-8")

    assert model_release_approval_status(settings) == (
        False,
        "Model release evaluation artifact does not contain the exact required safety scenarios.",
    )


def test_model_release_approval_rejects_stale_or_future_evaluation_artifact(
    tmp_path: Path,
):
    approval = _current_ollama_release_approval(tmp_path)
    settings = Settings(llm_provider="ollama", **approval)
    path = Path(settings.model_release_evaluation_artifact_path)
    artifact = json.loads(path.read_text(encoding="utf-8"))
    artifact["evaluated_at"] = (datetime.now(timezone.utc) - timedelta(days=91)).isoformat()
    artifact["sha256"] = evaluation_sha256(artifact)
    settings.model_release_evaluation_sha256 = artifact["sha256"]
    path.write_text(json.dumps(artifact), encoding="utf-8")

    assert model_release_approval_status(settings) == (
        False,
        "Model release evaluation artifact is older than 90 days.",
    )

    artifact["evaluated_at"] = (datetime.now(timezone.utc) + timedelta(minutes=6)).isoformat()
    artifact["sha256"] = evaluation_sha256(artifact)
    settings.model_release_evaluation_sha256 = artifact["sha256"]
    path.write_text(json.dumps(artifact), encoding="utf-8")

    assert model_release_approval_status(settings) == (
        False,
        "Model release evaluation artifact is dated in the future.",
    )


def test_model_release_approval_rejects_delivery_policy_drift(tmp_path: Path):
    approval = _current_ollama_release_approval(tmp_path)
    settings = Settings(llm_provider="ollama", **approval)
    path = Path(settings.model_release_evaluation_artifact_path)
    artifact = json.loads(path.read_text(encoding="utf-8"))
    artifact["delivery_policy_sha256"] = "0" * 64
    artifact["sha256"] = evaluation_sha256(artifact)
    settings.model_release_evaluation_sha256 = artifact["sha256"]
    path.write_text(json.dumps(artifact), encoding="utf-8")

    assert model_release_approval_status(settings) == (
        False,
        "Model release evaluation artifact does not match the configured coaching delivery policy.",
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
