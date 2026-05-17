"use client";

const BIAS_LABELS: Record<string, { label: string; color: string }> = {
  anchoring: { label: "Anchoring", color: "text-orange-400 bg-orange-900/30 border-orange-700" },
  premature_closure: {
    label: "Premature Closure",
    color: "text-red-400 bg-red-900/30 border-red-700",
  },
  availability: {
    label: "Availability",
    color: "text-purple-400 bg-purple-900/30 border-purple-700",
  },
  framing: { label: "Framing", color: "text-yellow-400 bg-yellow-900/30 border-yellow-700" },
};

interface Props {
  biases: string[];
}

export default function BiasAlert({ biases }: Props) {
  if (biases.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {biases.slice(0, 2).map((bias) => {
        const info = BIAS_LABELS[bias];
        if (!info) return null;
        return (
          <span
            key={bias}
            className={`text-xs px-2 py-0.5 rounded-full border font-medium ${info.color}`}
            title="Cognitive bias detected in your last response"
          >
            {info.label}
          </span>
        );
      })}
    </div>
  );
}
