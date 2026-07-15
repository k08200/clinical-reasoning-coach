const API_URL = process.env.SMOKE_API_URL ?? "http://127.0.0.1:8000";
const ADMIN_BOOTSTRAP_TOKEN = process.env.SMOKE_ADMIN_BOOTSTRAP_TOKEN;
const EXISTING_ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL;
const ADMIN_PASSWORD = "smokeadminpass123";
const LEARNER_PASSWORD = "smokelearnerpass123";
const REVIEW_NOTES =
  "Source alignment, hidden safety checks, and educational simulation limitations reviewed.";

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const detail = body?.detail ?? response.statusText;
    const message = typeof detail === "string" ? detail : JSON.stringify(detail);
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${message}`);
  }

  return body;
}

async function main() {
  if (!ADMIN_BOOTSTRAP_TOKEN && !EXISTING_ADMIN_EMAIL) {
    throw new Error(
      "SMOKE_ADMIN_BOOTSTRAP_TOKEN or SMOKE_ADMIN_EMAIL is required to verify the clinician review workflow.",
    );
  }

  const timestamp = Date.now();
  const adminEmail = EXISTING_ADMIN_EMAIL ?? `smoke-admin-${timestamp}@test.com`;
  const learnerEmail = `smoke-learner-${timestamp}@test.com`;

  if (!EXISTING_ADMIN_EMAIL) {
    await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password: ADMIN_PASSWORD,
        full_name: "Smoke Administrator",
        training_level: "fellow",
        accepted_educational_use: true,
      }),
    });
  }

  const tokens = await request("/api/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: adminEmail, password: ADMIN_PASSWORD }),
  });
  const refreshed = await request("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
  const adminHeaders = { Authorization: `Bearer ${refreshed.access_token}` };

  if (!EXISTING_ADMIN_EMAIL) {
    await request("/api/auth/admin/bootstrap", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ setup_token: ADMIN_BOOTSTRAP_TOKEN }),
    });
  }

  const clinicalCase = await request("/api/cases/generate/demo", {
    method: "POST",
    headers: adminHeaders,
  });

  await request(`/api/cases/${clinicalCase.id}/clinical-review`, {
    method: "POST",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      clinical_accuracy_confirmed: true,
      source_alignment_confirmed: true,
      source_alignment_checks: {
        teaching_points_supported: true,
        red_flags_supported: true,
        time_critical_actions_supported: true,
        contraindication_checks_supported: true,
      },
      reviewer_attestation: {
        practice_scope: "Emergency medicine educational simulation",
        attests_review_within_scope: true,
        attests_educational_use_only: true,
      },
      educational_safety_confirmed: true,
      review_notes: REVIEW_NOTES,
    }),
  });
  const reviewDetail = await request(
    `/api/cases/${clinicalCase.id}/clinical-review/detail`,
    { headers: adminHeaders },
  );
  const safetyReasoning = [
    ...reviewDetail.clinical_red_flags.map((item) => `I will address ${item}.`),
    ...reviewDetail.time_critical_actions.map((item) => `I will address ${item}.`),
    ...reviewDetail.contraindication_checks.map((item) => `I will assess ${item}.`),
  ].join("\n");

  await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: learnerEmail,
      password: LEARNER_PASSWORD,
      full_name: "Smoke Learner",
      training_level: "resident",
      accepted_educational_use: true,
    }),
  });

  const learnerTokens = await request("/api/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: learnerEmail, password: LEARNER_PASSWORD }),
  });
  const authHeaders = { Authorization: `Bearer ${learnerTokens.access_token}` };

  const session = await request("/api/sessions", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      case_id: clinicalCase.id,
      acknowledge_educational_simulation: true,
    }),
  });

  const streamResponse = await fetch(`${API_URL}/api/sessions/${session.id}/stream`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      content: safetyReasoning,
    }),
  });

  if (!streamResponse.ok) {
    throw new Error(`POST /stream failed: ${streamResponse.status}`);
  }
  const streamText = await streamResponse.text();
  if (!streamText.includes('"type": "done"')) {
    throw new Error("stream did not emit a done event");
  }

  const followUpResponse = await fetch(`${API_URL}/api/sessions/${session.id}/stream`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      content:
        "My differential prioritizes life-threatening sepsis, septic shock, stroke, hemorrhage, pulmonary embolism, acute coronary syndrome, and DKA before less dangerous causes. I will integrate fever, hypotension, altered mental status, lactate, WBC, blood culture, urinalysis, NIHSS, facial droop, atrial fibrillation, ECG, troponin, glucose, ketone, bicarbonate, and anion gap. This is time-sensitive because hypoperfusion and organ dysfunction suggest a mechanism that can rapidly worsen, while an embolic clot or ischemia can explain focal neurologic findings. The first priority is to use the evolving evidence to rule out critical diagnoses and state what would change the differential.",
    }),
  });
  if (!followUpResponse.ok) {
    throw new Error(`POST follow-up /stream failed: ${followUpResponse.status}`);
  }
  const followUpText = await followUpResponse.text();
  if (!followUpText.includes('"type": "done"')) {
    throw new Error("follow-up stream did not emit a done event");
  }

  const openSafetyEvents = await request(
    "/api/safety-events?event_status=open&limit=200",
    { headers: adminHeaders },
  );
  const sessionSafetyEvents = openSafetyEvents.filter(
    (event) => event.session_id === session.id,
  );
  const unexpectedSafetyEvents = sessionSafetyEvents.filter(
    (event) => event.event_type !== "unsafe_coach_output_guardrail",
  );
  if (unexpectedSafetyEvents.length) {
    throw new Error(
      `unexpected open safety events: ${unexpectedSafetyEvents
        .map((event) => event.event_type)
        .join(",")}`,
    );
  }
  for (const event of sessionSafetyEvents) {
    await request(`/api/safety-events/${event.id}/resolution`, {
      method: "PATCH",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "resolved",
        resolution_note:
          "Coach output guardrail was reviewed; unsafe content was replaced before learner delivery.",
      }),
    });
  }

  let saved = await request(`/api/sessions/${session.id}`, { headers: authHeaders });
  const roles = saved.messages.map((message) => message.role);
  if (roles.join(",") !== "coach,student,coach,student,coach") {
    throw new Error(`unexpected message roles: ${roles.join(",")}`);
  }
  if (saved.reasoning_map.nodes.length < 1) {
    throw new Error("reasoning map was not updated");
  }

  saved = await request(`/api/sessions/${session.id}/complete`, {
    method: "POST",
    headers: authHeaders,
  });
  if (saved.status !== "completed") {
    throw new Error(`session did not complete: ${saved.status}`);
  }

  const lockedSession = await request("/api/sessions", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      case_id: clinicalCase.id,
      acknowledge_educational_simulation: true,
    }),
  });
  const realPatientResponse = await fetch(
    `${API_URL}/api/sessions/${lockedSession.id}/stream`,
    {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "This is a real patient with severe chest pain right now.",
      }),
    },
  );
  const realPatientText = await realPatientResponse.text();
  if (!realPatientResponse.ok || !realPatientText.includes('"type": "done"')) {
    throw new Error("real-patient safety stream did not halt cleanly");
  }
  const lockedSaved = await request(`/api/sessions/${lockedSession.id}`, {
    headers: authHeaders,
  });
  if (
    lockedSaved.status !== "safety_locked" ||
    lockedSaved.messages.map((message) => message.role).join(",") !== "coach,coach"
  ) {
    throw new Error("real-patient signal did not lock the session before storing learner text");
  }
  const highRiskEvents = (await request(
    "/api/safety-events?event_type=real_patient_or_emergency_signal&event_status=open&limit=200",
    { headers: adminHeaders },
  )).filter((event) => event.session_id === lockedSession.id);
  if (highRiskEvents.length !== 1 || highRiskEvents[0].severity !== "high") {
    throw new Error("real-patient signal did not create one high-severity safety event");
  }
  const learnerResolution = await fetch(
    `${API_URL}/api/safety-events/${highRiskEvents[0].id}/resolution`,
    {
      method: "PATCH",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "resolved",
        resolution_note: "Reviewed and escalated to a supervising clinician.",
      }),
    },
  );
  if (learnerResolution.status !== 403) {
    throw new Error("learner was allowed to resolve a high-risk safety event");
  }
  const resolvedHighRiskEvent = await request(
    `/api/safety-events/${highRiskEvents[0].id}/resolution`,
    {
      method: "PATCH",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "resolved",
        resolution_note:
          "Reviewed real-patient signal, escalated to supervising clinician, and documented that this simulator was not used for patient care.",
      }),
    },
  );
  if (
    resolvedHighRiskEvent.status !== "resolved" ||
    resolvedHighRiskEvent.session_status !== "safety_locked"
  ) {
    throw new Error("reviewer resolution did not preserve the safety-locked session");
  }

  console.log(JSON.stringify({
    ok: true,
    apiUrl: API_URL,
    adminEmail,
    learnerEmail,
    caseTitle: clinicalCase.title,
    sessionId: session.id,
    lockedSessionId: lockedSession.id,
    resolvedCoachGuardrailEvents: sessionSafetyEvents.length,
    finalScore: saved.final_reasoning_score,
    totalTokens:
      saved.total_input_tokens +
      saved.total_output_tokens +
      saved.total_thinking_tokens,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
