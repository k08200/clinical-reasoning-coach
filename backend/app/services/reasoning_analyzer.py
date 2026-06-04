"""
Reasoning quality analyzer.

Uses the configured LLM provider to analyze student responses.
In mock mode this returns a rule-based score. In Claude mode it uses extended thinking.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from app.services.provider_factory import get_provider
from app.services.socratic_coach import review_feedback_safety_violations

ANALYSIS_SYSTEM = """You are an expert cognitive psychologist specializing in medical education and clinical reasoning.
Analyze a medical student's response during a clinical case discussion.

Evaluate:
1. REASONING QUALITY (0-100):
   - Systematic approach (considers multiple hypotheses)
   - Evidence integration (uses available data)
   - Prioritization (life-threatening first)
   - Mechanism understanding (not just pattern matching)

2. COGNITIVE BIASES detected:
   - anchoring: Fixed on initial impression
   - premature_closure: Settling on diagnosis without sufficient evidence
   - availability: Biased toward recently seen or memorable cases
   - framing: Led by how information was presented
   - search_satisficing: Stopping search once one answer found
   - commission: Bias toward action over watchful waiting

Return ONLY valid JSON:
{
  "reasoning_score": 0-100,
  "score_breakdown": {
    "systematic_approach": 0-25,
    "evidence_integration": 0-25,
    "prioritization": 0-25,
    "mechanism_understanding": 0-25
  },
  "biases_detected": [
    {
      "type": "anchoring|premature_closure|availability|framing|search_satisficing|commission",
      "severity": "mild|moderate|severe",
      "evidence": "specific text showing this bias",
      "confidence": 0.0-1.0
    }
  ],
  "reasoning_node": {
    "hypothesis": "...",
    "supporting_evidence": ["..."],
    "missing_evidence": ["..."],
    "reasoning_quality": "convergent|divergent|anchored|systematic"
  },
  "coach_insight": "Key observation for the coaching AI to use in next question",
  "student_strengths": ["..."],
  "student_gaps": ["..."]
}"""

SCORE_DIMENSIONS = (
    "systematic_approach",
    "evidence_integration",
    "prioritization",
    "mechanism_understanding",
)
VALID_BIAS_TYPES = {
    "anchoring",
    "premature_closure",
    "availability",
    "framing",
    "search_satisficing",
    "commission",
}
VALID_BIAS_SEVERITIES = {"mild", "moderate", "severe"}
VALID_REASONING_QUALITIES = {"convergent", "divergent", "anchored", "systematic"}
UNSAFE_REASONING_MAP_TEXT = (
    "Reasoning detail withheld because it resembled actionable medical advice."
)


@dataclass
class ReasoningAnalysis:
    reasoning_score: float
    score_breakdown: dict
    biases_detected: list
    reasoning_node: dict
    coach_insight: str
    student_strengths: list
    student_gaps: list
    thinking_content: str
    input_tokens: int
    output_tokens: int
    thinking_tokens: int


async def analyze_student_response(
    student_response: str,
    case_summary: str,
    conversation_history: list[dict],
    turn_number: int,
) -> ReasoningAnalysis:
    history_text = "\n".join([
        f"{m['role'].upper()}: {m['content'][:200]}..."
        if len(m['content']) > 200 else f"{m['role'].upper()}: {m['content']}"
        for m in conversation_history[-6:]
    ])

    prompt = f"""Case summary: {case_summary}

Conversation so far (last 3 turns):
{history_text}

Turn {turn_number} — Student response to analyze:
"{student_response}"

Analyze this student's clinical reasoning carefully."""

    provider = get_provider()
    response = await provider.complete(
        messages=[{"role": "user", "content": prompt}],
        system=ANALYSIS_SYSTEM,
    )

    raw = _extract_json(response.text)

    sanitized = _sanitize_analysis_payload(raw)

    return ReasoningAnalysis(
        reasoning_score=sanitized["reasoning_score"],
        score_breakdown=sanitized["score_breakdown"],
        biases_detected=sanitized["biases_detected"],
        reasoning_node=sanitized["reasoning_node"],
        coach_insight=sanitized["coach_insight"],
        student_strengths=sanitized["student_strengths"],
        student_gaps=sanitized["student_gaps"],
        thinking_content=response.thinking,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
        thinking_tokens=response.thinking_tokens,
    )


def build_reasoning_map(
    existing_map: dict,
    new_node: dict,
    turn_number: int,
) -> dict:
    map_data = existing_map if isinstance(existing_map, dict) else {}
    nodes = [
        _sanitize_reasoning_map_node(node)
        for node in _list_of_dicts(map_data.get("nodes"))
    ]
    edges = _list_of_dicts(map_data.get("edges"))
    sanitized_node = _sanitize_reasoning_node(new_node)

    node_id = f"turn_{turn_number}"
    previous_node_ids = {
        node.get("id")
        for node in nodes
        if isinstance(node.get("id"), str)
    }
    nodes = [
        node
        for node in nodes
        if node.get("id") != node_id
    ]
    nodes.append({
        "id": node_id,
        "turn": turn_number,
        "hypothesis": sanitized_node["hypothesis"],
        "quality": sanitized_node["reasoning_quality"],
        "supporting_evidence": sanitized_node["supporting_evidence"],
        "missing_evidence": sanitized_node["missing_evidence"],
    })

    if turn_number > 1:
        prev_id = f"turn_{turn_number - 1}"
        edge_id = f"edge_{prev_id}_{node_id}"
        edges = [
            edge
            for edge in edges
            if edge.get("id") != edge_id and edge.get("target") != node_id
        ]
        if prev_id in previous_node_ids:
            edges.append({
                "id": edge_id,
                "source": prev_id,
                "target": node_id,
            })

    return {"nodes": nodes, "edges": edges}


def _extract_json(text: str) -> dict:
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    raise ValueError(f"No JSON in response: {text[:200]}")


def _coerce_float(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number:
        return default
    return number


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _list_of_strings(value: Any, *, limit: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    return [
        item.strip()
        for item in value[:limit]
        if isinstance(item, str) and item.strip()
    ]


def _safe_reasoning_map_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = value.strip()
    if not text:
        return ""
    if review_feedback_safety_violations(text):
        return UNSAFE_REASONING_MAP_TEXT
    return text


def _safe_reasoning_map_list(value: Any, *, limit: int = 8) -> list[str]:
    return [
        safe_text
        for safe_text in (
            _safe_reasoning_map_text(item)
            for item in _list_of_strings(value, limit=limit)
        )
        if safe_text
    ]


def _list_of_dicts(value: Any, *, limit: int = 100) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [
        dict(item)
        for item in value[:limit]
        if isinstance(item, dict)
    ]


def _sanitize_score_breakdown(raw_breakdown: Any, raw_score: Any) -> tuple[float, dict[str, float]]:
    if not isinstance(raw_breakdown, dict):
        breakdown = {dimension: 0.0 for dimension in SCORE_DIMENSIONS}
        return 0.0, breakdown

    breakdown = {
        dimension: round(
            _clamp(_coerce_float(raw_breakdown.get(dimension), 0), 0, 25),
            1,
        )
        for dimension in SCORE_DIMENSIONS
    }
    score = round(sum(breakdown.values()), 1)
    return score, breakdown


def _sanitize_biases(raw_biases: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_biases, list):
        return []

    biases: list[dict[str, Any]] = []
    for raw_bias in raw_biases[:8]:
        if not isinstance(raw_bias, dict):
            continue
        bias_type = raw_bias.get("type")
        if bias_type not in VALID_BIAS_TYPES:
            continue
        severity = raw_bias.get("severity")
        if severity not in VALID_BIAS_SEVERITIES:
            severity = "mild"
        evidence = raw_bias.get("evidence")
        confidence = _clamp(_coerce_float(raw_bias.get("confidence"), 0.0), 0.0, 1.0)
        biases.append({
            "type": bias_type,
            "severity": severity,
            "evidence": evidence.strip() if isinstance(evidence, str) else "",
            "confidence": round(confidence, 3),
        })
    return biases


def _sanitize_reasoning_node(raw_node: Any) -> dict[str, Any]:
    if not isinstance(raw_node, dict):
        raw_node = {}

    quality = raw_node.get("reasoning_quality")
    if quality not in VALID_REASONING_QUALITIES:
        quality = "systematic"

    hypothesis = raw_node.get("hypothesis")
    return {
        "hypothesis": _safe_reasoning_map_text(hypothesis),
        "supporting_evidence": _safe_reasoning_map_list(raw_node.get("supporting_evidence")),
        "missing_evidence": _safe_reasoning_map_list(raw_node.get("missing_evidence")),
        "reasoning_quality": quality,
    }


def _sanitize_reasoning_map_node(raw_node: dict[str, Any]) -> dict[str, Any]:
    node: dict[str, Any] = {}
    node_id = raw_node.get("id")
    if isinstance(node_id, str) and node_id.strip():
        node["id"] = node_id.strip()
    turn = raw_node.get("turn")
    if isinstance(turn, int):
        node["turn"] = turn
    node["hypothesis"] = _safe_reasoning_map_text(raw_node.get("hypothesis"))
    quality = raw_node.get("quality")
    if isinstance(quality, str) and quality in VALID_REASONING_QUALITIES:
        node["quality"] = quality
    if "supporting_evidence" in raw_node:
        node["supporting_evidence"] = _safe_reasoning_map_list(
            raw_node.get("supporting_evidence")
        )
    if "missing_evidence" in raw_node:
        node["missing_evidence"] = _safe_reasoning_map_list(
            raw_node.get("missing_evidence")
        )
    return node


def _sanitize_analysis_payload(raw: dict[str, Any]) -> dict[str, Any]:
    score, breakdown = _sanitize_score_breakdown(
        raw.get("score_breakdown"),
        raw.get("reasoning_score"),
    )
    coach_insight = raw.get("coach_insight")
    return {
        "reasoning_score": score,
        "score_breakdown": breakdown,
        "biases_detected": _sanitize_biases(raw.get("biases_detected")),
        "reasoning_node": _sanitize_reasoning_node(raw.get("reasoning_node")),
        "coach_insight": coach_insight.strip() if isinstance(coach_insight, str) else "",
        "student_strengths": _list_of_strings(raw.get("student_strengths")),
        "student_gaps": _list_of_strings(raw.get("student_gaps")),
    }
