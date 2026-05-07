"use client";

import { getSmoothStepPath, type ConnectionLineComponentProps } from "reactflow";

export default function EasyConnectionLine({
  connectionStatus,
  fromX,
  fromY,
  toX,
  toY,
}: ConnectionLineComponentProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
  });

  const color = connectionStatus === "valid" ? "#10b981" : "#ef4444";

  return (
    <g>
      <path
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        d={edgePath}
      />
      <circle cx={toX} cy={toY} r={4} fill={color} />
    </g>
  );
}
