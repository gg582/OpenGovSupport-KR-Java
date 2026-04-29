import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type Stats = {
  pool: {
    workers: number;
    fastQueueDepth: number;
    slowQueueDepth: number;
    accepted: number;
    rejected: number;
    processed: number;
    avgLatencyMicro: number;
  };
  coalescer: { total: number; hits: number };
};

async function fetchStats(): Promise<Stats | null> {
  try {
    // Server-side fetch — bypass the rewrite so we can hit the backend directly
    // when running under `next dev` (rewrites only apply to client-side fetches
    // via the dev proxy).
    const backend = process.env.BACKEND_URL || "http://localhost:8080";
    const res = await fetch(`${backend}/api/runtime/stats`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Stats;
  } catch {
    return null;
  }
}

export default async function RuntimePage() {
  await headers(); // mark dynamic
  const stats = await fetchStats();
  const hitPct =
    stats && stats.coalescer.total > 0
      ? ((stats.coalescer.hits / stats.coalescer.total) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="space-y-4">
      <header className="panel">
        <div className="panel-header">런타임 상태</div>
        <div className="px-4 py-3 text-sm text-navy/80">
          백엔드의 워커 풀 + 단일플라이트 코얼레서 상태입니다. 페이지를 새로고침하면 갱신됩니다.
        </div>
      </header>

      {!stats && (
        <div className="panel border-red-300 bg-red-50">
          <div className="panel-header text-red-700">백엔드 연결 실패</div>
          <div className="px-4 py-3 text-sm text-red-700 font-mono">
            <code>GET /api/runtime/stats</code> 호출에 실패했습니다.
          </div>
        </div>
      )}

      {stats && (
        <div className="grid md:grid-cols-2 gap-4">
          <section className="panel">
            <div className="panel-header">워커 풀</div>
            <table className="gov-table">
              <tbody>
                <tr><th>워커 수</th><td className="font-mono">{stats.pool.workers}</td></tr>
                <tr><th>fast 큐 깊이</th><td className="font-mono">{stats.pool.fastQueueDepth}</td></tr>
                <tr><th>slow 큐 깊이</th><td className="font-mono">{stats.pool.slowQueueDepth}</td></tr>
                <tr><th>누적 accepted</th><td className="font-mono">{stats.pool.accepted.toLocaleString()}</td></tr>
                <tr><th>누적 rejected</th><td className="font-mono">{stats.pool.rejected.toLocaleString()}</td></tr>
                <tr><th>누적 processed</th><td className="font-mono">{stats.pool.processed.toLocaleString()}</td></tr>
                <tr><th>평균 지연 (µs)</th><td className="font-mono">{stats.pool.avgLatencyMicro.toLocaleString()}</td></tr>
              </tbody>
            </table>
          </section>

          <section className="panel">
            <div className="panel-header">코얼레서</div>
            <table className="gov-table">
              <tbody>
                <tr><th>전체 요청</th><td className="font-mono">{stats.coalescer.total.toLocaleString()}</td></tr>
                <tr><th>중복 흡수 (hit)</th><td className="font-mono">{stats.coalescer.hits.toLocaleString()}</td></tr>
                <tr><th>히트율</th><td className="font-mono">{hitPct} %</td></tr>
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
