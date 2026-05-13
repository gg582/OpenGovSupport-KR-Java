"use client";

export default function AxProgressBar({
  elapsedMs,
  maxMs,
}: {
  elapsedMs: number;
  maxMs: number;
}) {
  const pct = Math.min(100, (elapsedMs / maxMs) * 100);
  const remainingSec = Math.max(0, Math.ceil((maxMs - elapsedMs) / 1000));
  return (
    <div className="ax-progress">
      <div className="ax-progress-track">
        <div
          className="ax-progress-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="ax-progress-label">{remainingSec}초 남음</span>
    </div>
  );
}
