"use client";

import type { TokenUsage } from "@/types";

interface Props {
  usage: TokenUsage;
  thinking: boolean;
}

export default function TokenCounter({ usage, thinking }: Props) {
  const total =
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.thinking_tokens || 0);

  return (
    <div className="flex items-center gap-4 text-xs text-slate-500">
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        In: {(usage.input_tokens || 0).toLocaleString()}
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        Out: {(usage.output_tokens || 0).toLocaleString()}
      </span>
      <span className="flex items-center gap-1">
        <span
          className={`w-2 h-2 rounded-full ${
            thinking ? "bg-purple-400 animate-pulse" : "bg-purple-600"
          }`}
        />
        Thinking: {(usage.thinking_tokens || 0).toLocaleString()}
      </span>
      <span className="text-slate-600">|</span>
      <span className="font-medium text-slate-400">
        Total: {total.toLocaleString()} tokens
      </span>
    </div>
  );
}
