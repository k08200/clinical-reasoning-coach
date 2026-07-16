from __future__ import annotations

import httpx

from app.services import claude_provider, ollama_provider


class FakeOllamaClient:
    def __init__(
        self,
        response: httpx.Response | Exception,
        show_response: httpx.Response | Exception | None = None,
    ):
        self.response = response
        self.show_response = show_response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return None

    async def get(self, url: str) -> httpx.Response:
        if isinstance(self.response, Exception):
            raise self.response
        return self.response

    async def post(self, url: str, json: dict) -> httpx.Response:
        response = self.show_response
        if isinstance(response, Exception):
            raise response
        if response is None:
            raise AssertionError("Expected a model metadata response")
        return response


async def test_ollama_readiness_accepts_implicit_latest_tag(monkeypatch):
    monkeypatch.setattr(ollama_provider, "OLLAMA_BASE_URL", "http://ollama.test")
    monkeypatch.setattr(ollama_provider, "OLLAMA_MODEL", "llama3.2")
    monkeypatch.setattr(
        ollama_provider.httpx,
        "AsyncClient",
        lambda **_: FakeOllamaClient(
            httpx.Response(
                200,
                json={"models": [{"name": "llama3.2:latest"}]},
                request=httpx.Request("GET", "http://ollama.test/api/tags"),
            ),
            httpx.Response(
                200,
                json={"model_info": {"llama.context_length": 8192}},
                request=httpx.Request("POST", "http://ollama.test/api/show"),
            ),
        ),
    )

    readiness = await ollama_provider.OllamaProvider().readiness()

    assert readiness.ready is True
    assert readiness.verification == "verified"


async def test_ollama_readiness_rejects_insufficient_context_window(monkeypatch):
    monkeypatch.setattr(ollama_provider, "OLLAMA_MODEL", "small-model")
    monkeypatch.setattr(ollama_provider, "OLLAMA_MIN_CONTEXT_TOKENS", 4096)
    monkeypatch.setattr(
        ollama_provider.httpx,
        "AsyncClient",
        lambda **_: FakeOllamaClient(
            httpx.Response(
                200,
                json={"models": [{"name": "small-model:latest"}]},
                request=httpx.Request("GET", "http://ollama.test/api/tags"),
            ),
            httpx.Response(
                200,
                json={"model_info": {"qwen.context_length": 2048}},
                request=httpx.Request("POST", "http://ollama.test/api/show"),
            ),
        ),
    )

    readiness = await ollama_provider.OllamaProvider().readiness()

    assert readiness.ready is False
    assert "2048 < 4096" in readiness.detail


async def test_ollama_readiness_rejects_missing_configured_model(monkeypatch):
    monkeypatch.setattr(ollama_provider, "OLLAMA_MODEL", "llama3.2")
    monkeypatch.setattr(
        ollama_provider.httpx,
        "AsyncClient",
        lambda **_: FakeOllamaClient(
            httpx.Response(
                200,
                json={"models": [{"name": "mistral:latest"}]},
                request=httpx.Request("GET", "http://ollama.test/api/tags"),
            )
        ),
    )

    readiness = await ollama_provider.OllamaProvider().readiness()

    assert readiness.ready is False
    assert readiness.detail == "The configured Ollama model is not installed."


async def test_ollama_readiness_handles_unreachable_server(monkeypatch):
    monkeypatch.setattr(
        ollama_provider.httpx,
        "AsyncClient",
        lambda **_: FakeOllamaClient(
            httpx.ConnectError("offline", request=httpx.Request("GET", "http://ollama.test"))
        ),
    )

    readiness = await ollama_provider.OllamaProvider().readiness()

    assert readiness.ready is False
    assert readiness.detail == "Ollama could not be reached for a readiness check."


class FakeClaudeMessages:
    def __init__(self):
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return object()


class FakeClaudeClient:
    def __init__(self):
        self.messages = FakeClaudeMessages()
        self.closed = False

    async def close(self):
        self.closed = True


async def test_claude_readiness_uses_bounded_non_clinical_probe(monkeypatch):
    client = FakeClaudeClient()
    monkeypatch.setattr(claude_provider.anthropic, "AsyncAnthropic", lambda **_: client)

    readiness = await claude_provider.ClaudeProvider().readiness()

    assert readiness.ready is True
    assert client.closed is True
    assert client.messages.calls[0]["max_tokens"] == 1
    assert client.messages.calls[0]["messages"] == [
        {"role": "user", "content": "Readiness check. Reply with OK."}
    ]
