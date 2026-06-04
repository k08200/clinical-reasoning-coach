"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/api";
import { streamMessage } from "@/lib/streaming";
import { useRequireAuth } from "@/lib/useAuthGate";
import type { CoachingSession, Message, SessionReview, TokenUsage, User } from "@/types";
import TokenCounter from "@/components/TokenCounter";
import ReasoningMap from "@/components/ReasoningMap";
import ChatMessage from "@/components/ChatMessage";
import BiasAlert from "@/components/BiasAlert";

const MAX_STUDENT_MESSAGE_LENGTH = 4000;

type CompletionSafetyCategory = {
  category: string;
  label: string;
  missing_count: number;
};

type CompletionSafetyDetail = {
  code: "clinical_safety_coverage_incomplete";
  message: string;
  covered_count: number;
  total_count: number;
  uncovered_categories: CompletionSafetyCategory[];
};

type CompletionReasoningTurnsDetail = {
  code: "minimum_reasoning_turns_incomplete";
  message: string;
  analyzed_turn_count: number;
  minimum_turn_count: number;
  remaining_turn_count: number;
};

type CompletionReasoningQualityDetail = {
  code: "clinical_reasoning_quality_incomplete";
  message: string;
  current_score: number;
  minimum_score: number;
};

type CompletionReasoningDimensionDetail = {
  code: "clinical_reasoning_dimension_incomplete";
  message: string;
  deficient_dimensions: {
    dimension: string;
    label: string;
    current_score: number;
    minimum_score: number;
  }[];
};

type CompletionActiveBiasDetail = {
  code: "active_severe_cognitive_bias";
  message: string;
  biases: {
    bias_type: string;
    label: string;
    severity: string;
    confidence: number;
    message_turn: number;
  }[];
};

type CompletionManagementSafetyDetail = {
  code: "management_before_safety_checks_incomplete";
  message: string;
  unsafe_management_turns: {
    turn: number;
    detected_terms: string[];
    missing_red_flags?: string[];
    missing_time_critical_actions?: string[];
    missing_contraindication_checks: string[];
  }[];
};

type CompletionOpenSafetyEventsDetail = {
  code: "open_safety_events_unresolved";
  message: string;
  open_safety_events: {
    event_type: string;
    severity: string;
    message_turn: number;
    detected_terms: string[];
  }[];
};

function safetyCoverageLabel(category: string): string {
  if (category === "red_flags") return "Red Flags";
  if (category === "time_critical_actions") return "Time-Critical Actions";
  return "Contraindication Checks";
}

function sessionSafetyEventLabel(eventType: string): string {
  if (eventType === "management_before_safety_checks") {
    return "Management before safety checks";
  }
  if (eventType === "unsafe_coach_output_guardrail") {
    return "Coach output guardrail";
  }
  if (eventType === "possible_patient_identifier") {
    return "Possible patient identifier";
  }
  if (eventType === "real_patient_or_emergency_signal") {
    return "Real patient or emergency signal";
  }
  return eventType.replace(/_/g, " ");
}

const REVIEW_AUDIT_LABELS: Record<string, string> = {
  clinical_accuracy_confirmed: "Clinical accuracy",
  source_alignment_confirmed: "Source alignment",
  educational_safety_confirmed: "Educational safety",
  teaching_points_supported: "Teaching points",
  red_flags_supported: "Red flags",
  time_critical_actions_supported: "Time-critical actions",
  contraindication_checks_supported: "Contraindication checks",
};

function reviewAuditLabel(key: string): string {
  return REVIEW_AUDIT_LABELS[key] ?? key.replace(/_/g, " ");
}

function isCompletionSafetyDetail(value: unknown): value is CompletionSafetyDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    value.code === "clinical_safety_coverage_incomplete" &&
    "message" in value &&
    typeof value.message === "string" &&
    "covered_count" in value &&
    typeof value.covered_count === "number" &&
    "total_count" in value &&
    typeof value.total_count === "number" &&
    "uncovered_categories" in value &&
    Array.isArray(value.uncovered_categories)
  );
}

function isCompletionReasoningTurnsDetail(
  value: unknown,
): value is CompletionReasoningTurnsDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    value.code === "minimum_reasoning_turns_incomplete" &&
    "message" in value &&
    typeof value.message === "string" &&
    "analyzed_turn_count" in value &&
    typeof value.analyzed_turn_count === "number" &&
    "minimum_turn_count" in value &&
    typeof value.minimum_turn_count === "number" &&
    "remaining_turn_count" in value &&
    typeof value.remaining_turn_count === "number"
  );
}

function isCompletionReasoningQualityDetail(
  value: unknown,
): value is CompletionReasoningQualityDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    value.code === "clinical_reasoning_quality_incomplete" &&
    "message" in value &&
    typeof value.message === "string" &&
    "current_score" in value &&
    typeof value.current_score === "number" &&
    "minimum_score" in value &&
    typeof value.minimum_score === "number"
  );
}

function isCompletionReasoningDimensionDetail(
  value: unknown,
): value is CompletionReasoningDimensionDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    value.code === "clinical_reasoning_dimension_incomplete" &&
    "message" in value &&
    typeof value.message === "string" &&
    "deficient_dimensions" in value &&
    Array.isArray(value.deficient_dimensions)
  );
}

function isCompletionActiveBiasDetail(value: unknown): value is CompletionActiveBiasDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    value.code === "active_severe_cognitive_bias" &&
    "message" in value &&
    typeof value.message === "string" &&
    "biases" in value &&
    Array.isArray(value.biases)
  );
}

function isCompletionManagementSafetyDetail(
  value: unknown,
): value is CompletionManagementSafetyDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    value.code === "management_before_safety_checks_incomplete" &&
    "message" in value &&
    typeof value.message === "string" &&
    "unsafe_management_turns" in value &&
    Array.isArray(value.unsafe_management_turns)
  );
}

function isCompletionOpenSafetyEventsDetail(
  value: unknown,
): value is CompletionOpenSafetyEventsDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    value.code === "open_safety_events_unresolved" &&
    "message" in value &&
    typeof value.message === "string" &&
    "open_safety_events" in value &&
    Array.isArray(value.open_safety_events)
  );
}

function errorDetail(error: unknown): unknown {
  if (!error || typeof error !== "object" || !("detail" in error)) return null;
  return error.detail;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

function isCaseAccessBlockMessage(message: string): boolean {
  return (
    message.includes("Case quality gate blocks learner sessions") ||
    message.includes("requires re-review before learner sessions can start") ||
    message.includes("requires updated clinical review before learner sessions can start") ||
    message.includes("no supporting clinical source")
  );
}

function isUser(value: unknown): value is User {
  return (
    !!value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "role" in value &&
    typeof value.role === "string"
  );
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const checkingAuth = useRequireAuth();

  const { data: currentUser, error: currentUserError } = useSWR<User>(
    !checkingAuth ? "/api/auth/me" : null,
    () => api.auth.me() as Promise<User>,
    { refreshInterval: 0 },
  );
  const { data: session, error: sessionError, mutate } = useSWR<CoachingSession>(
    id && !checkingAuth ? `/api/sessions/${id}` : null,
    () => api.sessions.get(id) as Promise<CoachingSession>,
    { refreshInterval: 0 },
  );
  const { data: review, error: reviewError } = useSWR<SessionReview>(
    session?.status === "completed" ? `/api/sessions/${id}/review` : null,
    () => api.sessions.review(id) as Promise<SessionReview>,
    { refreshInterval: 0 },
  );

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [liveTokens, setLiveTokens] = useState<Partial<TokenUsage>>({});
  const [showMap, setShowMap] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");
  const [caseAccessBlockMessage, setCaseAccessBlockMessage] = useState("");
  const [completionSafetyDetail, setCompletionSafetyDetail] =
    useState<CompletionSafetyDetail | null>(null);
  const [completionReasoningTurnsDetail, setCompletionReasoningTurnsDetail] =
    useState<CompletionReasoningTurnsDetail | null>(null);
  const [completionReasoningQualityDetail, setCompletionReasoningQualityDetail] =
    useState<CompletionReasoningQualityDetail | null>(null);
  const [completionReasoningDimensionDetail, setCompletionReasoningDimensionDetail] =
    useState<CompletionReasoningDimensionDetail | null>(null);
  const [completionActiveBiasDetail, setCompletionActiveBiasDetail] =
    useState<CompletionActiveBiasDetail | null>(null);
  const [completionManagementSafetyDetail, setCompletionManagementSafetyDetail] =
    useState<CompletionManagementSafetyDetail | null>(null);
  const [completionOpenSafetyEventsDetail, setCompletionOpenSafetyEventsDetail] =
    useState<CompletionOpenSafetyEventsDetail | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const allMessages: Message[] = [
    ...(session?.messages ?? []),
    ...(streamingText
      ? [
          {
            id: "streaming",
            role: "coach" as const,
            content: streamingText,
            reasoning_score: null,
            biases_detected: [],
            created_at: new Date().toISOString(),
          },
        ]
      : []),
  ];

  const totalTokens: TokenUsage = {
    input_tokens: (session?.total_input_tokens ?? 0) + (liveTokens.input_tokens ?? 0),
    output_tokens: (session?.total_output_tokens ?? 0) + (liveTokens.output_tokens ?? 0),
    thinking_tokens: (session?.total_thinking_tokens ?? 0) + (liveTokens.thinking_tokens ?? 0),
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages.length, streamingText]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming || !session) return;
    if (session.status !== "active") {
      setError("This session is not active.");
      return;
    }

    const content = input.trim();
    if (content.length > MAX_STUDENT_MESSAGE_LENGTH) {
      setError(
        `Keep each response under ${MAX_STUDENT_MESSAGE_LENGTH.toLocaleString()} characters. Avoid pasting clinical notes or patient records into this simulator.`,
      );
      return;
    }
    setInput("");
    setStreaming(true);
    setThinking(false);
    setStreamingText("");
    setError("");
    setCaseAccessBlockMessage("");
    setCompletionSafetyDetail(null);
    setCompletionReasoningTurnsDetail(null);
    setCompletionReasoningQualityDetail(null);
    setCompletionReasoningDimensionDetail(null);
    setCompletionActiveBiasDetail(null);
    setCompletionManagementSafetyDetail(null);
    setCompletionOpenSafetyEventsDetail(null);

    try {
      await streamMessage(id, content, {
        onThinking: () => setThinking(true),
        onText: (text) => {
          setThinking(false);
          setStreamingText((prev) => prev + text);
        },
        onUsage: (usage) => {
          setLiveTokens((prev) => ({
            input_tokens: (prev.input_tokens ?? 0) + (usage.input_tokens ?? 0),
            output_tokens: (prev.output_tokens ?? 0) + (usage.output_tokens ?? 0),
            thinking_tokens: (prev.thinking_tokens ?? 0) + (usage.thinking_tokens ?? 0),
          }));
        },
        onDone: async () => {
          // Refresh session to get saved messages + analysis
          await mutate();
          setLiveTokens({});
          setStreaming(false);
          setStreamingText("");
          setThinking(false);
        },
        onError: (message) => {
          setStreaming(false);
          setStreamingText("");
          setThinking(false);
          setLiveTokens({});
          setInput(content);
          if (isCaseAccessBlockMessage(message)) {
            setCaseAccessBlockMessage(message);
            setError("");
          } else {
            setError(message);
          }
        },
      });
    } catch (err) {
      setError(errorMessage(err, "Could not send your response"));
      setLiveTokens({});
      setStreaming(false);
      setStreamingText("");
      setThinking(false);
      setInput(content);
    }
  }, [input, streaming, session, id, mutate]);

  async function handleComplete() {
    setCompleting(true);
    setError("");
    setCaseAccessBlockMessage("");
    setCompletionSafetyDetail(null);
    setCompletionReasoningTurnsDetail(null);
    setCompletionReasoningQualityDetail(null);
    setCompletionReasoningDimensionDetail(null);
    setCompletionActiveBiasDetail(null);
    setCompletionManagementSafetyDetail(null);
    setCompletionOpenSafetyEventsDetail(null);
    try {
      await api.sessions.complete(id);
      await mutate();
    } catch (err) {
      const detail = errorDetail(err);
      if (isCompletionSafetyDetail(detail)) {
        setCompletionSafetyDetail(detail);
        setError("");
      } else if (isCompletionReasoningTurnsDetail(detail)) {
        setCompletionReasoningTurnsDetail(detail);
        setError("");
      } else if (isCompletionReasoningQualityDetail(detail)) {
        setCompletionReasoningQualityDetail(detail);
        setError("");
      } else if (isCompletionReasoningDimensionDetail(detail)) {
        setCompletionReasoningDimensionDetail(detail);
        setError("");
      } else if (isCompletionActiveBiasDetail(detail)) {
        setCompletionActiveBiasDetail(detail);
        setError("");
      } else if (isCompletionManagementSafetyDetail(detail)) {
        setCompletionManagementSafetyDetail(detail);
        setError("");
      } else if (isCompletionOpenSafetyEventsDetail(detail)) {
        setCompletionOpenSafetyEventsDetail(detail);
        setError("");
      } else {
        const message = errorMessage(err, "Could not finish the session");
        if (isCaseAccessBlockMessage(message)) {
          setCaseAccessBlockMessage(message);
          setError("");
        } else {
          setError(message);
        }
      }
    } finally {
      setCompleting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const recentBiases = session?.messages
    .filter((m) => m.biases_detected.length > 0)
    .slice(-1)[0]?.biases_detected ?? [];

  if (checkingAuth || (!session && !sessionError) || (!currentUser && !currentUserError)) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (sessionError || !session) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center px-6">
        <div className="max-w-md rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
          Could not load this session. Please return to cases and try again.
        </div>
      </div>
    );
  }

  const isCompleted = session.status === "completed";
  const isSafetyLocked = session.status === "safety_locked";
  const hasCurrentUser = isUser(currentUser);
  const isSessionOwner = !hasCurrentUser || currentUser.id === session.user_id;
  const isReadOnlySessionContext = session.status === "active" && !isSessionOwner;
  const isInteractive = session.status === "active" && isSessionOwner;
  const openSafetyEvents = (session.safety_events ?? []).filter(
    (event) => event.status === "open",
  );
  const trimmedInputLength = input.trim().length;
  const inputTooLong = trimmedInputLength > MAX_STUDENT_MESSAGE_LENGTH;
  const analyzedLearnerTurnCount = session.messages.filter(
    (message) => message.role === "student" && message.reasoning_score !== null,
  ).length;
  const minimumLearnerTurnsForCompletion = 2;
  const canCompleteSession = analyzedLearnerTurnCount >= minimumLearnerTurnsForCompletion;
  const completionBlockedMessage =
    analyzedLearnerTurnCount === 0
      ? "Add at least one analyzed learner response before finishing the session."
      : "Complete one more analyzed reasoning turn before finishing the session.";
  const completionSafetyMessage =
    "Before finishing, address red flags, time-critical actions, and contraindication checks.";

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-700 px-4 py-3 flex items-center justify-between shrink-0">
        <button
          onClick={() => router.push("/cases")}
          className="text-slate-400 hover:text-white text-sm flex items-center gap-1"
        >
          ← Cases
        </button>

        <div className="flex items-center gap-3">
          {recentBiases.length > 0 && <BiasAlert biases={recentBiases} />}

          <button
            onClick={() => setShowMap((v) => !v)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              showMap
                ? "bg-brand-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            Reasoning Map
          </button>

          {isInteractive && (
            <div className="text-right">
              <button
                onClick={handleComplete}
                disabled={completing || !canCompleteSession}
                title={canCompleteSession ? completionSafetyMessage : completionBlockedMessage}
                className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                {completing ? "Finishing..." : "Finish Session"}
              </button>
              <p className="mt-1 max-w-64 text-xs text-slate-500">
                {canCompleteSession ? completionSafetyMessage : completionBlockedMessage}
              </p>
            </div>
          )}
          {isSafetyLocked && (
            <span className="rounded-full border border-red-800 bg-red-950/50 px-3 py-1.5 text-xs font-semibold text-red-200">
              Safety Locked
            </span>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Chat area */}
        <div className="flex-1 flex flex-col">
          {/* Token counter */}
          <div className="px-4 py-2 border-b border-slate-800">
            <TokenCounter usage={totalTokens} thinking={thinking} />
          </div>

          <div className="border-b border-amber-800/60 bg-amber-950/40 px-4 py-2 text-xs leading-relaxed text-amber-100">
            Educational simulation only. For real patients, urgent deterioration, or emergencies,
            follow local protocols and contact a supervising clinician or emergency services
            immediately.
          </div>

          {error && (
            <div className="mx-4 mt-4 rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {caseAccessBlockMessage && (
            <div className="mx-4 mt-4 rounded-lg border border-amber-700 bg-amber-950/45 px-4 py-3 text-sm leading-relaxed text-amber-100">
              <p className="font-semibold">Clinical case review is required before continuing</p>
              <p className="mt-1 text-amber-200">{caseAccessBlockMessage}</p>
              <p className="mt-3 text-xs text-amber-300">
                This session cannot continue until the case has current clinician review,
                reputable source alignment, and complete safety metadata.
              </p>
            </div>
          )}

          {completionSafetyDetail && (
            <div className="mx-4 mt-4 rounded-lg border border-amber-700 bg-amber-950/45 px-4 py-3 text-sm leading-relaxed text-amber-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">Clinical safety reasoning still needs work</p>
                  <p className="mt-1 text-amber-200">
                    {completionSafetyDetail.covered_count} of{" "}
                    {completionSafetyDetail.total_count} hidden safety targets are covered.
                    Continue the case and make your reasoning explicit before finishing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => textareaRef.current?.focus()}
                  className="rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-900/60"
                >
                  Continue Reasoning
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {completionSafetyDetail.uncovered_categories.map((category) => (
                  <span
                    key={category.category}
                    className="rounded-full border border-amber-700 bg-slate-900/50 px-3 py-1 text-xs text-amber-100"
                  >
                    {category.label}: {category.missing_count} remaining
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-amber-300">
                The checklist stays hidden for assessment integrity. In your next response,
                discuss the dangerous findings, urgent actions, and treatment safety checks you
                would actively consider.
              </p>
            </div>
          )}

          {completionReasoningTurnsDetail && (
            <div className="mx-4 mt-4 rounded-lg border border-amber-700 bg-amber-950/45 px-4 py-3 text-sm leading-relaxed text-amber-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">More clinical reasoning is needed</p>
                  <p className="mt-1 text-amber-200">
                    {completionReasoningTurnsDetail.analyzed_turn_count} of{" "}
                    {completionReasoningTurnsDetail.minimum_turn_count} analyzed learner turns are
                    complete. Answer one more coach question before finishing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => textareaRef.current?.focus()}
                  className="rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-900/60"
                >
                  Continue Reasoning
                </button>
              </div>
              <p className="mt-3 text-xs text-amber-300">
                A usable review needs at least two analyzed reasoning turns so the coach can assess
                how your differential, evidence, and safety plan evolve.
              </p>
            </div>
          )}

          {completionReasoningQualityDetail && (
            <div className="mx-4 mt-4 rounded-lg border border-amber-700 bg-amber-950/45 px-4 py-3 text-sm leading-relaxed text-amber-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">Clinical reasoning quality still needs work</p>
                  <p className="mt-1 text-amber-200">
                    Current analyzed score:{" "}
                    {completionReasoningQualityDetail.current_score.toFixed(1)}/100.
                    Minimum to finish:{" "}
                    {completionReasoningQualityDetail.minimum_score.toFixed(0)}/100.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => textareaRef.current?.focus()}
                  className="rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-900/60"
                >
                  Continue Reasoning
                </button>
              </div>
              <p className="mt-3 text-xs text-amber-300">
                Continue the case and make the differential, supporting evidence,
                prioritization, and mechanism explicit before finishing.
              </p>
            </div>
          )}

          {completionReasoningDimensionDetail && (
            <div className="mx-4 mt-4 rounded-lg border border-amber-700 bg-amber-950/45 px-4 py-3 text-sm leading-relaxed text-amber-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">Core reasoning dimension still needs work</p>
                  <p className="mt-1 text-amber-200">
                    Strengthen each low-scoring reasoning dimension before finishing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => textareaRef.current?.focus()}
                  className="rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-900/60"
                >
                  Continue Reasoning
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {completionReasoningDimensionDetail.deficient_dimensions.map((dimension) => (
                  <span
                    key={dimension.dimension}
                    className="rounded-full border border-amber-700 bg-slate-900/50 px-3 py-1 text-xs text-amber-100"
                  >
                    {dimension.label}: {dimension.current_score.toFixed(1)}/25
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-amber-300">
                A usable clinical reasoning review needs enough strength across prioritization,
                evidence integration, systematic approach, and mechanism explanation.
              </p>
            </div>
          )}

          {completionActiveBiasDetail && (
            <div className="mx-4 mt-4 rounded-lg border border-amber-700 bg-amber-950/45 px-4 py-3 text-sm leading-relaxed text-amber-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">Severe cognitive bias still needs work</p>
                  <p className="mt-1 text-amber-200">
                    Revisit the latest reasoning turn and explain how you would test,
                    disconfirm, or correct the bias before finishing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => textareaRef.current?.focus()}
                  className="rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-900/60"
                >
                  Continue Reasoning
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {completionActiveBiasDetail.biases.map((bias) => (
                  <span
                    key={`${bias.bias_type}-${bias.message_turn}`}
                    className="rounded-full border border-amber-700 bg-slate-900/50 px-3 py-1 text-xs text-amber-100"
                  >
                    {bias.label}: {(bias.confidence * 100).toFixed(0)}% confidence
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-amber-300">
                A completed review should show that dangerous closure, fixation, or action bias
                has been actively challenged.
              </p>
            </div>
          )}

          {completionManagementSafetyDetail && (
            <div className="mx-4 mt-4 rounded-lg border border-amber-700 bg-amber-950/45 px-4 py-3 text-sm leading-relaxed text-amber-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">Management safety sequence still needs work</p>
                  <p className="mt-1 text-amber-200">
                    Revisit the management plan and explain contraindication or safety checks
                    before committing to risky treatment.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => textareaRef.current?.focus()}
                  className="rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-900/60"
                >
                  Continue Reasoning
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {completionManagementSafetyDetail.unsafe_management_turns.map((turn) => {
                  const missingSafetySections = [
                    { label: "Red flags", items: turn.missing_red_flags ?? [] },
                    {
                      label: "Time-critical actions",
                      items: turn.missing_time_critical_actions ?? [],
                    },
                    {
                      label: "Contraindication checks",
                      items: turn.missing_contraindication_checks,
                    },
                  ];

                  return (
                    <div
                      key={`${turn.turn}-${turn.detected_terms.join("-")}`}
                      className="rounded-lg border border-amber-700 bg-slate-900/50 px-3 py-2 text-xs text-amber-100"
                    >
                      <p className="font-semibold">
                        Turn {turn.turn}: {turn.detected_terms.join(", ")}
                      </p>
                      {missingSafetySections.map(({ label, items }) => (
                        items.length > 0 ? (
                          <p key={label} className="mt-1 text-amber-200">
                            {label}: {items.join("; ")}
                          </p>
                        ) : null
                      ))}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-amber-300">
                Completion requires red flags, time-critical actions, and safety checks to
                come before simulated treatment or disposition decisions, not only somewhere
                later in the transcript.
              </p>
            </div>
          )}

          {completionOpenSafetyEventsDetail && (
            <div className="mx-4 mt-4 rounded-lg border border-amber-700 bg-amber-950/45 px-4 py-3 text-sm leading-relaxed text-amber-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">Open safety events need review</p>
                  <p className="mt-1 text-amber-200">
                    {completionOpenSafetyEventsDetail.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => textareaRef.current?.focus()}
                  className="rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-900/60"
                >
                  Continue Reasoning
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {completionOpenSafetyEventsDetail.open_safety_events.map((event) => (
                  <div
                    key={`${event.event_type}-${event.message_turn}-${event.detected_terms.join("-")}`}
                    className="rounded-lg border border-amber-700 bg-slate-900/50 px-3 py-2 text-xs text-amber-100"
                  >
                    <p className="font-semibold">
                      Turn {event.message_turn}: {event.event_type}
                    </p>
                    <p className="mt-1 text-amber-200">Severity: {event.severity}</p>
                    {event.detected_terms.length > 0 && (
                      <p className="mt-1 text-amber-200">
                        Detected: {event.detected_terms.join(", ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-amber-300">
                Completion is blocked until the safety issue is addressed in the
                simulation or reviewed in the safety audit workflow.
              </p>
            </div>
          )}

          {!isCompleted && !isSafetyLocked && openSafetyEvents.length > 0 && (
            <div className="mx-4 mt-4 rounded-lg border border-amber-700 bg-amber-950/45 px-4 py-3 text-sm leading-relaxed text-amber-100">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">Open safety event requires attention</p>
                  <p className="mt-1 text-amber-200">
                    Before finishing this simulation, address the safety issue in the reasoning
                    flow or have it reviewed in the safety audit workflow.
                  </p>
                </div>
                <span className="rounded-full border border-amber-700 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-amber-100">
                  {openSafetyEvents.length} open
                </span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {openSafetyEvents.map((event) => (
                  <div
                    key={`${event.event_type}-${event.message_turn}-${event.detected_terms.join("-")}`}
                    className="rounded-lg border border-amber-700 bg-slate-900/50 px-3 py-2 text-xs text-amber-100"
                  >
                    <p className="font-semibold">
                      Turn {event.message_turn}: {sessionSafetyEventLabel(event.event_type)}
                    </p>
                    <p className="mt-1 capitalize text-amber-200">
                      Severity: {event.severity}
                    </p>
                    {event.detected_terms.length > 0 && (
                      <p className="mt-1 text-amber-200">
                        Detected: {event.detected_terms.join(", ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isSafetyLocked && (
            <div className="mx-4 mt-4 rounded-lg border border-red-700 bg-red-950/50 px-4 py-3 text-sm leading-relaxed text-red-100">
              <p className="font-semibold">This session has been locked for safety review.</p>
              <p className="mt-1 text-red-200">
                Coaching is stopped because the session included a possible real-patient,
                emergency, or patient-identifier signal. Do not continue this scenario here;
                follow local clinical or privacy protocols and contact the appropriate supervisor.
              </p>
            </div>
          )}

          {isReadOnlySessionContext && (
            <div className="mx-4 mt-4 rounded-lg border border-sky-800 bg-sky-950/35 px-4 py-3 text-sm leading-relaxed text-sky-100">
              <p className="font-semibold">Safety review read-only context</p>
              <p className="mt-1 text-sky-200">
                This transcript is available for safety event review. Message entry and session
                completion remain limited to the learner who owns the simulation.
              </p>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {allMessages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                isStreaming={msg.id === "streaming"}
                thinking={thinking && msg.id === "streaming"}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Completed overlay */}
          {isCompleted && (
            <div className="bg-slate-800 px-4 py-4 border-t border-slate-700">
              <div className="max-w-4xl mx-auto">
                <p className="text-slate-300 font-semibold mb-1">Session Complete</p>
                <p className="text-slate-400 text-sm mb-2">
                  Simulation reasoning score:{" "}
                  <strong className="text-brand-400">
                    {session.final_reasoning_score?.toFixed(0) ?? "N/A"}/100
                  </strong>
                </p>
                <p className="mb-2 text-xs leading-relaxed text-amber-200">
                  This score reflects performance in this simulated educational case only. It is
                  not a certification of clinical competence, independent practice readiness, or
                  safe care for real patients.
                </p>
                <p className="text-slate-500 text-xs">
                  Top biases:{" "}
                  {Object.entries(session.bias_summary)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([k, v]) => `${k} (×${v})`)
                    .join(", ") || "None detected"}
                </p>
                {reviewError && (
                  <p className="mt-3 rounded-lg border border-red-700 bg-red-900/40 px-3 py-2 text-sm text-red-200">
                    Could not load the learning review.
                  </p>
                )}
                {review && (
                  <div className="mt-4 grid gap-4 text-left lg:grid-cols-3">
                    <section className="rounded-lg border border-amber-700/60 bg-amber-950/20 p-3 lg:col-span-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                        Simulation Review Notice
                      </p>
                      <p className="mt-2 text-sm text-amber-100">{review.educational_notice}</p>
                    </section>

                    {review.source_provenance.requires_caution && (
                      <section className="rounded-lg border border-amber-700 bg-amber-950/35 p-3 lg:col-span-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                          Clinical Case Review Warning
                        </p>
                        <p className="mt-2 text-sm text-amber-100">
                          Current case provenance: {review.source_provenance.review_label}. Treat
                          this completed review as provisional educational feedback until clinician
                          re-review restores source provenance.
                        </p>
                      </section>
                    )}

                    {review.review_audit && (
                      <section className="rounded-lg border border-emerald-800/70 bg-emerald-950/20 p-3 lg:col-span-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">
                              Clinician Review Audit
                            </p>
                            {review.review_audit.review_notes && (
                              <p className="mt-2 text-sm text-emerald-50">
                                {review.review_audit.review_notes}
                              </p>
                            )}
                          </div>
                          {(() => {
                            const auditEntries = [
                              ...Object.entries(review.review_audit.confirmations),
                              ...Object.entries(review.review_audit.source_alignment_checks),
                            ];
                            const confirmedCount = auditEntries.filter(([, value]) => value).length;
                            return (
                              <span className="rounded-full border border-emerald-800 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-emerald-100">
                                {confirmedCount}/{auditEntries.length} confirmed
                              </span>
                            );
                          })()}
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {Object.entries(review.review_audit.confirmations).map(
                            ([key, confirmed]) => (
                              <div
                                key={key}
                                className="flex items-center justify-between gap-3 rounded border border-emerald-900/70 bg-slate-950/50 px-3 py-2 text-sm"
                              >
                                <span className="text-slate-200">{reviewAuditLabel(key)}</span>
                                <span
                                  className={
                                    confirmed
                                      ? "text-xs font-semibold text-emerald-200"
                                      : "text-xs font-semibold text-amber-200"
                                  }
                                >
                                  {confirmed ? "Confirmed" : "Not confirmed"}
                                </span>
                              </div>
                            ),
                          )}
                          {Object.entries(review.review_audit.source_alignment_checks).map(
                            ([key, confirmed]) => (
                              <div
                                key={key}
                                className="flex items-center justify-between gap-3 rounded border border-emerald-900/70 bg-slate-950/50 px-3 py-2 text-sm"
                              >
                                <span className="text-slate-200">{reviewAuditLabel(key)}</span>
                                <span
                                  className={
                                    confirmed
                                      ? "text-xs font-semibold text-emerald-200"
                                      : "text-xs font-semibold text-amber-200"
                                  }
                                >
                                  {confirmed ? "Confirmed" : "Not confirmed"}
                                </span>
                              </div>
                            ),
                          )}
                        </div>
                      </section>
                    )}

                    {review.safety_events.length > 0 && (
                      <section className="rounded-lg border border-red-800/70 bg-red-950/25 p-3 lg:col-span-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-red-200">
                              Safety Event History
                            </p>
                            <p className="mt-2 text-sm text-red-100">
                              This completed session had safety events that were reviewed before
                              completion.
                            </p>
                          </div>
                          <span className="rounded-full border border-red-800 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-red-100">
                            {review.safety_events.length} reviewed
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {review.safety_events.map((event) => (
                            <div
                              key={`${event.message_turn}-${event.event_type}-${event.status}`}
                              className="rounded border border-red-900/70 bg-slate-950/50 p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-red-50">
                                  Turn {event.message_turn}: {event.event_type.replace(/_/g, " ")}
                                </p>
                                <span className="rounded-full border border-red-900 bg-red-950/40 px-2 py-0.5 text-xs capitalize text-red-100">
                                  {event.status}
                                </span>
                              </div>
                              <p className="mt-1 text-xs capitalize text-red-200">
                                Severity: {event.severity}
                              </p>
                              {event.detected_terms.length > 0 && (
                                <p className="mt-2 text-xs text-slate-300">
                                  Detected: {event.detected_terms.join(", ")}
                                </p>
                              )}
                              {event.resolution_note && (
                                <p className="mt-2 text-xs text-slate-300">
                                  {event.resolution_note}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {!review.clinical_safety_completion.complete && (
                      <section className="rounded-lg border border-amber-700 bg-amber-950/35 p-3 lg:col-span-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                              Incomplete Safety Coverage
                            </p>
                            <p className="mt-2 text-sm text-amber-100">
                              {review.clinical_safety_completion.message}
                            </p>
                          </div>
                          <span className="rounded-full border border-amber-700 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-amber-100">
                            {review.clinical_safety_coverage.covered_count}/
                            {review.clinical_safety_coverage.total_count} addressed
                          </span>
                        </div>
                        {review.clinical_safety_completion.uncovered_categories.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {review.clinical_safety_completion.uncovered_categories.map(
                              (category) => (
                                <span
                                  key={category.category}
                                  className="rounded-full border border-amber-700 bg-slate-900/50 px-3 py-1 text-xs text-amber-100"
                                >
                                  {category.label}: {category.missing_count} missing
                                </span>
                              ),
                            )}
                          </div>
                        )}
                      </section>
                    )}

                    <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Final Diagnosis (Simulation)
                      </p>
                      <p className="mt-2 text-sm font-semibold text-white">{review.diagnosis}</p>
                      <p className="mt-2 text-xs text-slate-400">{review.diagnosis_notice}</p>
                      <p className="mt-2 text-xs capitalize text-slate-500">
                        {review.source_provenance.review_label}
                        {review.last_reviewed_at ? ` · Reviewed ${review.last_reviewed_at}` : ""}
                      </p>
                    </section>

                    <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Teaching Points</p>
                      <ul className="mt-2 space-y-1 text-sm text-slate-300">
                        {review.key_teaching_points.map((point) => (
                          <li key={point}>• {point}</li>
                        ))}
                      </ul>
                    </section>

                    <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Cognitive Traps</p>
                      <ul className="mt-2 space-y-1 text-sm text-slate-300">
                        {review.cognitive_traps.map((trap) => (
                          <li key={trap}>• {trap}</li>
                        ))}
                      </ul>
                    </section>

                    {Object.keys(review.score_breakdown).length > 0 && (
                      <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 lg:col-span-3">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Reasoning Breakdown</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                          {Object.entries(review.score_breakdown).map(([dimension, score]) => (
                            <div key={dimension}>
                              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                                <span className="capitalize text-slate-300">
                                  {dimension.replace(/_/g, " ")}
                                </span>
                                <span className="font-semibold text-white">{score.toFixed(0)}</span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-700">
                                <div
                                  className="h-2 rounded-full bg-brand-500"
                                  style={{ width: `${Math.max(4, Math.min(100, score))}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {(review.strengths.length > 0 || review.gaps.length > 0) && (
                      <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 lg:col-span-2">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Feedback</p>
                        {review.strengths.length > 0 && (
                          <>
                            <p className="mt-2 text-xs font-semibold text-emerald-300">Strengths</p>
                            <ul className="mt-1 space-y-1 text-sm text-slate-300">
                              {review.strengths.map((strength) => (
                                <li key={strength}>• {strength}</li>
                              ))}
                            </ul>
                          </>
                        )}
                        {review.gaps.length > 0 && (
                          <>
                            <p className="mt-3 text-xs font-semibold text-amber-300">Growth Areas</p>
                            <ul className="mt-1 space-y-1 text-sm text-slate-300">
                              {review.gaps.map((gap) => (
                                <li key={gap}>• {gap}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </section>
                    )}

                    {(review.coach_insights.length > 0 || review.bias_feedback.length > 0) && (
                      <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 lg:col-span-1">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Coaching Notes</p>
                        {review.coach_insights.map((insight) => (
                          <p key={insight} className="mt-2 text-sm text-slate-300">
                            {insight}
                          </p>
                        ))}
                        {review.bias_feedback.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {review.bias_feedback.map((bias) => (
                              <div
                                key={`${bias.message_turn}-${bias.bias_type}-${bias.evidence}`}
                                className="rounded border border-slate-700 bg-slate-800/70 p-2"
                              >
                                <p className="text-xs font-semibold capitalize text-amber-200">
                                  {bias.bias_type.replace(/_/g, " ")} · {bias.severity}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">{bias.evidence}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    )}

                    {review.clinical_safety_coverage.total_count > 0 && (
                      <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 lg:col-span-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                              Clinical Safety Coverage
                            </p>
                            <p className="mt-1 text-sm text-slate-300">
                              {review.clinical_safety_coverage.covered_count} of{" "}
                              {review.clinical_safety_coverage.total_count} hidden safety targets
                              addressed
                            </p>
                          </div>
                          <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200">
                            {Math.round(
                              (review.clinical_safety_coverage.covered_count /
                                review.clinical_safety_coverage.total_count) *
                                100,
                            )}
                            %
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 lg:grid-cols-3">
                          {(
                            [
                              "red_flags",
                              "time_critical_actions",
                              "contraindication_checks",
                            ] as const
                          ).map((category) => (
                            <div key={category} className="rounded-lg border border-slate-700 bg-slate-800/70 p-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {safetyCoverageLabel(category)}
                              </p>
                              <ul className="mt-2 space-y-2">
                                {review.clinical_safety_coverage[category].map((item) => (
                                  <li key={item.item} className="text-sm">
                                    <div className="flex items-start gap-2">
                                      <span
                                        className={
                                          item.covered
                                            ? "mt-0.5 text-emerald-300"
                                            : "mt-0.5 text-amber-300"
                                        }
                                      >
                                        {item.covered ? "Covered" : "Missed"}
                                      </span>
                                      <div>
                                        <p className="text-slate-200">{item.item}</p>
                                        {item.evidence_turns.length > 0 && (
                                          <p className="mt-0.5 text-xs text-slate-500">
                                            Turn {item.evidence_turns.join(", ")}
                                          </p>
                                        )}
                                        {item.evidence.length > 0 && (
                                          <div className="mt-2 space-y-1">
                                            {item.evidence.map((evidence) => (
                                              <p
                                                key={`${item.item}-${evidence.turn}-${evidence.excerpt}`}
                                                className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-xs text-slate-400"
                                              >
                                                Turn {evidence.turn}: {evidence.excerpt}
                                              </p>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 lg:col-span-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Clinical Sources</p>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        {review.clinical_sources.map((source) => (
                          <a
                            key={`${source.organization}-${source.title}`}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-slate-700 bg-slate-800/80 p-3 text-sm text-slate-300 hover:border-slate-500"
                          >
                            <span className="block font-medium text-white">{source.title}</span>
                            <span className="mt-1 block text-xs text-slate-400">
                              {source.organization}
                            </span>
                            {source.supports.length > 0 && (
                              <span className="mt-2 block text-xs text-slate-500">
                                Supports: {source.supports.join(", ")}
                              </span>
                            )}
                          </a>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Input */}
          {isSafetyLocked && (
            <div className="border-t border-red-900 bg-red-950/40 px-4 py-4 text-sm text-red-100">
              Message entry is disabled for this locked session.
            </div>
          )}

          {isReadOnlySessionContext && (
            <div className="border-t border-sky-900 bg-sky-950/30 px-4 py-4 text-sm text-sky-100">
              Message entry is disabled in read-only safety review context.
            </div>
          )}

          {isInteractive && (
            <div className="px-4 py-3 border-t border-slate-700 shrink-0">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={streaming}
                  rows={2}
                  maxLength={MAX_STUDENT_MESSAGE_LENGTH + 500}
                  placeholder="Share your clinical reasoning... (Enter to send, Shift+Enter for newline)"
                  className={`flex-1 px-3 py-2 bg-slate-700 border rounded-lg text-white placeholder-slate-500 resize-none focus:outline-none disabled:opacity-50 ${
                    inputTooLong
                      ? "border-red-500 focus:border-red-400"
                      : "border-slate-600 focus:border-brand-500"
                  }`}
                />
                <button
                  onClick={sendMessage}
                  disabled={streaming || !input.trim() || inputTooLong}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors shrink-0"
                >
                  {streaming ? "..." : "Send"}
                </button>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                <p className={inputTooLong ? "text-red-300" : "text-slate-500"}>
                  {trimmedInputLength.toLocaleString()}/
                  {MAX_STUDENT_MESSAGE_LENGTH.toLocaleString()} characters
                </p>
                {inputTooLong && (
                  <p className="text-red-300">
                    Shorten this response and do not paste clinical notes or patient records.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Reasoning map panel */}
        {showMap && (
          <div className="w-96 border-l border-slate-700 shrink-0 overflow-hidden">
            <div className="p-3 border-b border-slate-700">
              <h3 className="text-sm font-semibold text-white">Reasoning Map</h3>
              <p className="text-xs text-slate-400">Your diagnostic journey</p>
            </div>
            <div className="h-full">
              <ReasoningMap reasoningMap={session.reasoning_map} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
