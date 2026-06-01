"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/api";
import { streamMessage } from "@/lib/streaming";
import { useRequireAuth } from "@/lib/useAuthGate";
import type { CoachingSession, Message, TokenUsage } from "@/types";
import TokenCounter from "@/components/TokenCounter";
import ReasoningMap from "@/components/ReasoningMap";
import ChatMessage from "@/components/ChatMessage";
import BiasAlert from "@/components/BiasAlert";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const checkingAuth = useRequireAuth();

  const { data: session, error: sessionError, mutate } = useSWR<CoachingSession>(
    id && !checkingAuth ? `/api/sessions/${id}` : null,
    () => api.sessions.get(id) as Promise<CoachingSession>,
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

          {!isCompleted && (
            <button
              onClick={handleComplete}
              disabled={completing}
              className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg disabled:opacity-50 transition-colors"
            >
              {completing ? "Finishing..." : "Finish Session"}
            </button>
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
            <div className="px-4 py-3 bg-slate-800 border-t border-slate-700">
              <div className="max-w-2xl mx-auto text-center">
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
              </div>
            </div>
          )}

          {/* Input */}
          {!isCompleted && (
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
