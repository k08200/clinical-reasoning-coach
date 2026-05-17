"""
Reasoning quality analyzer.

Uses the configured LLM provider to analyze student responses.
In mock mode this returns a rule-based score. In Claude mode it uses extended thinking.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.services.provider_factory import get_provider

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

    return ReasoningAnalysis(
        reasoning_score=float(raw.get("reasoning_score", 50)),
        score_breakdown=raw.get("score_breakdown", {}),
        biases_detected=raw.get("biases_detected", []),
        reasoning_node=raw.get("reasoning_node", {}),
        coach_insight=raw.get("coach_insight", ""),
        student_strengths=raw.get("student_strengths", []),
        student_gaps=raw.get("student_gaps", []),
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
    nodes = list(existing_map.get("nodes", []))
    edges = list(existing_map.get("edges", []))

    node_id = f"turn_{turn_number}"
    nodes.append({
        "id": node_id,
        "turn": turn_number,
        "hypothesis": new_node.get("hypothesis", ""),
        "quality": new_node.get("reasoning_quality", "unknown"),
        "supporting_evidence": new_node.get("supporting_evidence", []),
        "missing_evidence": new_node.get("missing_evidence", []),
    })

    if turn_number > 1:
        prev_id = f"turn_{turn_number - 1}"
        edges.append({
            "id": f"edge_{prev_id}_{node_id}",
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
