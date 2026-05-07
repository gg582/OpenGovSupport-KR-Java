import * as fs from "fs";
import * as path from "path";

/**
 * 단순 파일 로거. Electron 의 main 프로세스 + 자식 프로세스 stdout/stderr 를
 * 사용자 데이터 디렉터리의 logs 폴더에 누적. 콘솔에는 노출하지 않는다 (NO terminal 원칙).
 */
export class FileLogger {
  private readonly stream: fs.WriteStream;
  private readonly file: string;

  constructor(dir: string, name: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${name}.log`);
    // 7일 회전 — 1MB 초과 시 .old 로 이동.
    try {
      const st = fs.statSync(this.file);
      if (st.size > 1_000_000) {
        try { fs.renameSync(this.file, this.file + ".old"); } catch { /* ignore */ }
      }
    } catch { /* not exists */ }
    this.stream = fs.createWriteStream(this.file, { flags: "a" });
  }

  info(msg: string): void {
    this.stream.write(`[${ts()}] INFO  ${msg}\n`);
  }

  warn(msg: string): void {
    this.stream.write(`[${ts()}] WARN  ${msg}\n`);
  }

  error(msg: string): void {
    this.stream.write(`[${ts()}] ERROR ${msg}\n`);
  }

  raw(prefix: string, chunk: Buffer | string): void {
    const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (const line of s.split(/\r?\n/)) {
      if (line.length > 0) this.stream.write(`[${ts()}] ${prefix} ${line}\n`);
    }
  }

  path(): string {
    return this.file;
  }

  close(): void {
    this.stream.end();
  }
}

function ts(): string {
  const d = new Date();
  return d.toISOString().replace("T", " ").replace("Z", "");
}
