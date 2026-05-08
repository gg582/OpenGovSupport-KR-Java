import * as net from "net";

/**
 * 운영체제에 빈 TCP 포트를 빌려달라 요청한 뒤 즉시 닫는다.
 * 충돌 없이 백엔드/프런트엔드를 띄우기 위해 사용.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "localhost", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("address unavailable")));
      }
    });
  });
}
