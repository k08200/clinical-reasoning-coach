const API_URL = process.env.SMOKE_API_URL ?? "http://127.0.0.1:8000";
const PASSWORD = "smokepass123";

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const detail = body?.detail ?? response.statusText;
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${detail}`);
  }

  return body;
}

async function main() {
  const email = `smoke-${Date.now()}@test.com`;

  await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      full_name: "Smoke Tester",
      training_level: "resident",
    }),
  });

  const tokens = await request("/api/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email, password: PASSWORD }),
  });
  const authHeaders = { Authorization: `Bearer ${tokens.access_token}` };

  const clinicalCase = await request("/api/cases/generate/demo", {
    method: "POST",
    headers: authHeaders,
  });

  const session = await request("/api/sessions", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ case_id: clinicalCase.id }),
  });

  const streamResponse = await fetch(`${API_URL}/api/sessions/${session.id}/stream`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      content:
        "I am considering dangerous causes first and want key tests before committing.",
    }),
  });

  if (!streamResponse.ok) {
    throw new Error(`POST /stream failed: ${streamResponse.status}`);
  }
  const streamText = await streamResponse.text();
  if (!streamText.includes('"type": "done"')) {
    throw new Error("stream did not emit a done event");
  }

  let saved = await request(`/api/sessions/${session.id}`, { headers: authHeaders });
  const roles = saved.messages.map((message) => message.role);
  if (roles.join(",") !== "coach,student,coach") {
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

  console.log(JSON.stringify({
    ok: true,
    apiUrl: API_URL,
    email,
    caseTitle: clinicalCase.title,
    sessionId: session.id,
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
