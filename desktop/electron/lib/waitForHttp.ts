import * as http from "http";

/**
 * 백엔드/프런트엔드 헬스체크. 200 응답이 올 때까지 폴링.
 *
 * @param url        대상 URL (예: http://127.0.0.1:8080/api/health)
 * @param timeoutMs  최대 대기 시간 (기본 60초)
 * @param intervalMs 폴 간격 (기본 200ms)
 */
export async function waitForHttp(
  url: string,
  timeoutMs = 60_000,
  intervalMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      await probe(url);
      return;
    } catch (e) {
      lastErr = e;
      await sleep(intervalMs);
    }
  }
  throw new Error(
    `health check timeout for ${url}: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

function probe(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      const code = res.statusCode ?? 0;
      // 2xx, 3xx, 4xx 다 OK — 서버가 응답한다는 신호이면 충분.
      if (code >= 200 && code < 500) {
        res.resume();
        resolve();
      } else {
        res.resume();
        reject(new Error(`status ${code}`));
      }
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("probe timeout"));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
