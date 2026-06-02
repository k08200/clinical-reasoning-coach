"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/api";
import { streamMessage } from "@/lib/streaming";
import { useRequireAuth } from "@/lib/useAuthGate";
import type { CoachingSession, Message, SessionReview, TokenUsage } from "@/types";
import TokenCounter from "@/components/TokenCounter";
import ReasoningMap from "@/components/ReasoningMap";
import ChatMessage from "@/components/ChatMessage";
import BiasAlert from "@/components/BiasAlert";

function safetyCoverageLabel(category: string): string {
  if (category === "red_flags") return "Red Flags";
  if (category === "time_critical_actions") return "Time-Critical Actions";
  return "Contraindication Checks";
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const checkingAuth = useRequireAuth();

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
    setInput("");
    setStreaming(true);
    setThinking(false);
    setStreamingText("");
    setError("");

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
          setError(message);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your response");
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
    try {
      await api.sessions.complete(id);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish the session");
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

  if (checkingAuth || (!session && !sessionError)) {
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
  const isInteractive = session.status === "active";
  const canCompleteSession = session.messages.some(
    (message) => message.role === "student" && message.reasoning_score !== null,
  );
  const completionBlockedMessage =
    "Add at least one analyzed learner response before finishing the session.";
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
                  Final reasoning score:{" "}
                  <strong className="text-brand-400">
                    {session.final_reasoning_score?.toFixed(0) ?? "N/A"}/100
                  </strong>
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
                    <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Final Diagnosis</p>
                      <p className="mt-2 text-sm font-semibold text-white">{review.diagnosis}</p>
                      <p className="mt-2 text-xs capitalize text-slate-500">
                        {review.review_status.replace(/_/g, " ")}
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
                  placeholder="Share your clinical reasoning... (Enter to send, Shift+Enter for newline)"
                  className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 resize-none focus:outline-none focus:border-brand-500 disabled:opacity-50"
                />
                <button
                  onClick={sendMessage}
                  disabled={streaming || !input.trim()}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors shrink-0"
                >
                  {streaming ? "..." : "Send"}
                </button>
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
