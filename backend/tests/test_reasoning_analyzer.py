"""Tests for reasoning analyzer — mocked provider calls."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.reasoning_analyzer import (
    analyze_student_response,
    build_reasoning_map,
    _extract_json,
)


MOCK_ANALYSIS_JSON = """{
  "reasoning_score": 72,
  "score_breakdown": {
    "systematic_approach": 18,
    "evidence_integration": 20,
    "prioritization": 17,
    "mechanism_understanding": 17
  },
  "biases_detected": [
    {
      "type": "anchoring",
      "severity": "moderate",
      "evidence": "Student immediately focused on MI without considering other causes",
      "confidence": 0.75
    }
  ],
  "reasoning_node": {
    "hypothesis": "Myocardial infarction",
    "supporting_evidence": ["chest pain", "diaphoresis", "age"],
    "missing_evidence": ["ECG results", "troponin trend", "radiation pattern"],
    "reasoning_quality": "anchored"
  },
  "coach_insight": "Student is anchoring on MI. Ask about other chest pain differentials.",
  "student_strengths": ["Identified high-risk presentation"],
  "student_gaps": ["Not considering PE or aortic dissection", "Missing full differential"]
}"""


@pytest.mark.asyncio
async def test_analyze_student_response():
    from app.services.provider import LLMResponse

    mock_response = LLMResponse(
        text=MOCK_ANALYSIS_JSON,
        thinking="Internal reasoning about anchoring bias...",
        input_tokens=500,
        output_tokens=200,
        thinking_tokens=1200,
    )

    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(return_value=mock_response)

    with patch(
        "app.services.reasoning_analyzer.get_provider",
        return_value=mock_provider,
    ):
        result = await analyze_student_response(
            student_response="This is definitely a heart attack. We should give aspirin immediately.",
            case_summary="58yo male, chest pain, diaphoresis",
            conversation_history=[],
            turn_number=1,
        )

    assert result.reasoning_score == 72
    assert len(result.biases_detected) == 1
    assert result.biases_detected[0]["type"] == "anchoring"
    assert result.input_tokens == 500
    assert result.thinking_tokens == 1200


def test_build_reasoning_map_first_turn():
    node = {
        "hypothesis": "MI",
        "supporting_evidence": ["chest pain"],
        "missing_evidence": ["ECG"],
        "reasoning_quality": "anchored",
    }
    result = build_reasoning_map(
        existing_map={"nodes": [], "edges": []},
        new_node=node,
        turn_number=1,
    )
    assert len(result["nodes"]) == 1
    assert result["nodes"][0]["id"] == "turn_1"
    assert len(result["edges"]) == 0


def test_build_reasoning_map_subsequent_turn():
    existing = {
        "nodes": [{"id": "turn_1", "hypothesis": "MI"}],
        "edges": [],
    }
    node = {
        "hypothesis": "PE or MI",
        "supporting_evidence": ["dyspnea", "tachycardia"],
        "missing_evidence": ["D-dimer"],
        "reasoning_quality": "systematic",
    }
    result = build_reasoning_map(
        existing_map=existing,
        new_node=node,
        turn_number=2,
    )
    assert len(result["nodes"]) == 2
    assert len(result["edges"]) == 1
    assert result["edges"][0]["source"] == "turn_1"
    assert result["edges"][0]["target"] == "turn_2"


def test_extract_json_from_code_block():
    text = '```json\n{"key": "value"}\n```'
    result = _extract_json(text)
    assert result == {"key": "value"}


def test_extract_json_raw():
    text = 'Some text before {"key": "value"} some text after'
    result = _extract_json(text)
    assert result == {"key": "value"}


def test_extract_json_no_json_raises():
    with pytest.raises(ValueError):
        _extract_json("no json here")
