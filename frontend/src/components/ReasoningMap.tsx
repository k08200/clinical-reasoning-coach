"use client";

import { useMemo } from "react";
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from "reactflow";
import "reactflow/dist/style.css";
import type { ReasoningMap as ReasoningMapType } from "@/types";

const QUALITY_COLORS = {
  anchored: "#f97316",
  convergent: "#22c55e",
  divergent: "#a855f7",
  systematic: "#0ea5e9",
  unknown: "#64748b",
};

interface Props {
  reasoningMap: ReasoningMapType;
}

export default function ReasoningMap({ reasoningMap }: Props) {
  const nodes: Node[] = useMemo(
    () =>
      reasoningMap.nodes.map((n, i) => ({
        id: n.id,
        position: { x: 120, y: i * 120 },
        data: {
          label: (
            <div className="text-left">
              <div className="font-semibold text-xs text-slate-200 mb-0.5">
                Turn {n.turn}
              </div>
              <div className="text-[10px] text-slate-300 max-w-[140px] truncate">
                {n.hypothesis || "Exploring..."}
              </div>
              <div
                className="text-[9px] mt-0.5 px-1.5 py-0.5 rounded-full inline-block"
                style={{
                  background:
                    QUALITY_COLORS[n.quality as keyof typeof QUALITY_COLORS] + "33",
                  color:
                    QUALITY_COLORS[n.quality as keyof typeof QUALITY_COLORS],
                }}
              >
                {n.quality}
              </div>
            </div>
          ),
        },
        style: {
          background: "#1e293b",
          border: `2px solid ${QUALITY_COLORS[n.quality as keyof typeof QUALITY_COLORS] || "#64748b"}`,
          borderRadius: "8px",
          padding: "8px",
          width: 160,
        },
      })),
    [reasoningMap.nodes],
  );

  const edges: Edge[] = useMemo(
    () =>
      reasoningMap.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        style: { stroke: "#475569", strokeWidth: 1.5 },
        animated: true,
      })),
    [reasoningMap.edges],
  );

  if (reasoningMap.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm p-8 text-center">
        Start reasoning to see your diagnostic journey visualized here
      </div>
    );
  }

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#334155" variant={BackgroundVariant.Dots} />
        <Controls showInteractive={false} className="text-slate-300" />
        <MiniMap
          nodeColor="#334155"
          maskColor="rgba(15, 23, 42, 0.7)"
          style={{ background: "#0f172a", border: "1px solid #334155" }}
        />
      </ReactFlow>
    </div>
  );
}
