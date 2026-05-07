"use client";

import { getSmoothStepPath } from "@reactflow/core";

type Props = {
  connectionStatus: "valid" | "invalid" | null;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

export default function EasyConnectionLine({
  connectionStatus,
  fromX,
  fromY,
  toX,
  toY,
}: Props) {
  const [edgePath] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
  });

  const color = connectionStatus === "valid" ? "#10b981" : "#ef4444";

  return (
    <g>
      <path fill="none" stroke={color} strokeWidth={2.5} d={edgePath} />
      <circle cx={toX} cy={toY} r={4} fill={color} />
    </g>
  );
}
