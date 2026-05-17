"use client";

import type { Message } from "@/types";

interface Props {
  message: Message;
  isStreaming?: boolean;
  thinking?: boolean;
}

export default function ChatMessage({ message, isStreaming, thinking }: Props) {
  const isCoach = message.role === "coach";

  return (
    <div className={`flex gap-3 animate-fade-in ${isCoach ? "" : "flex-row-reverse"}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          isCoach ? "bg-brand-600 text-white" : "bg-slate-600 text-slate-200"
        }`}
      >
        {isCoach ? "AI" : "You"}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[75%] rounded-xl px-4 py-3 ${
          isCoach
            ? "bg-slate-800 border border-slate-700 text-slate-100"
            : "bg-brand-700 text-white"
        }`}
      >
        {thinking ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-thinking-pulse"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <span>Analyzing your reasoning...</span>
          </div>
        ) : (
          <div className="prose-coach whitespace-pre-wrap text-sm leading-relaxed">
            {message.content}
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 bg-brand-400 ml-0.5 animate-pulse" />
            )}
          </div>
        )}

        {/* Reasoning score badge (for student messages after analysis) */}
        {!isCoach && message.reasoning_score !== null && (
          <div className="mt-2 pt-2 border-t border-blue-600/30 flex items-center gap-2">
            <span className="text-xs text-blue-300">
              Reasoning score:{" "}
              <strong>{message.reasoning_score.toFixed(0)}</strong>/100
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
