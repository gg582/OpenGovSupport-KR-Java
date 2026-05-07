import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { backendJar, frontendEntry, javaBin, resourcePath, dataDir, logsDir } from "./paths";
import { FileLogger } from "./logger";
import { findFreePort } from "./findFreePort";
import { waitForHttp } from "./waitForHttp";

/**
 * Java 백엔드와 Next.js 프런트엔드 서버를 자식 프로세스로 띄운다.
 *
 * - Java 백엔드: jlink 으로 만든 JRE + Spring Boot fat jar.  HTTPS 비활성화 + 임의 포트.
 * - Next 프런트: standalone 빌드 산출물의 server.js 를 node 로 실행.  BACKEND_URL env 로 리라이트.
 *
 * 두 프로세스 모두 stdout/stderr 는 사용자 logs 폴더로 리다이렉트 — 터미널에 절대 노출 안함.
 */
export class Backend {
  private proc: ChildProcess | null = null;
  private readonly log: FileLogger;
  port = 0;

  constructor() {
    this.log = new FileLogger(logsDir(), "backend");
  }

  async start(): Promise<{ port: number }> {
    this.port = await findFreePort();
    const java = javaBin();
    const jar = backendJar();

    if (!fs.existsSync(java)) {
      throw new Error(`Java 런타임을 찾지 못했습니다: ${java}`);
    }
    if (!fs.existsSync(jar)) {
      throw new Error(`백엔드 jar 를 찾지 못했습니다: ${jar}`);
    }

    const args = [
      // 메모리 — 데스크톱 환경 보수적 기본.
      "-Xmx512m",
      "-XX:+UseG1GC",
      "-Dfile.encoding=UTF-8",
      // 헤드리스 + 임의 포트 + HTTPS 비활성 + 사용자 데이터 영역.
      "-Djava.awt.headless=true",
      `-Dserver.port=${this.port}`,
      "-Dserver.ssl.enabled=false",
      `-Duser.home=${process.env.HOME ?? process.env.USERPROFILE ?? ""}`,
      `-Dopengov.data.dir=${dataDir()}`,
      "-jar",
      jar,
    ];

    this.log.info(`spawning backend: ${java} ${args.join(" ")}`);

    this.proc = spawn(java, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        OPENGOV_DESKTOP: "1",
      },
    });

    this.proc.stdout?.on("data", (c) => this.log.raw("BE/STDOUT", c));
    this.proc.stderr?.on("data", (c) => this.log.raw("BE/STDERR", c));
    this.proc.on("exit", (code, sig) => {
      this.log.warn(`backend exited code=${code} sig=${sig}`);
    });

    // 헬스체크 — Spring Boot 부팅 시간을 90초까지 허용.
    await waitForHttp(`http://127.0.0.1:${this.port}/api/health`, 90_000);
    this.log.info(`backend healthy at :${this.port}`);
    return { port: this.port };
  }

  stop(): void {
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill("SIGTERM");
      } catch { /* ignore */ }
      this.proc = null;
    }
    this.log.close();
  }
}

export class Frontend {
  private proc: ChildProcess | null = null;
  private readonly log: FileLogger;
  port = 0;

  constructor() {
    this.log = new FileLogger(logsDir(), "frontend");
  }

  async start(backendPort: number): Promise<{ port: number }> {
    this.port = await findFreePort();
    const entry = frontendEntry();
    if (!fs.existsSync(entry)) {
      throw new Error(`프런트엔드 server.js 를 찾지 못했습니다: ${entry}`);
    }

    // Next standalone 은 자체 node 런타임이 필요 — Electron 에 내장된 node 사용.
    const electronExec = process.execPath;
    this.log.info(`spawning frontend: ${electronExec} ${entry}`);

    this.proc = spawn(electronExec, [entry], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      cwd: path.dirname(entry),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",     // Electron 을 순수 node 로 실행
        PORT: String(this.port),
        HOSTNAME: "127.0.0.1",
        NODE_ENV: "production",
        BACKEND_URL: `http://127.0.0.1:${backendPort}`,
        OPENGOV_DESKTOP: "1",
        // standalone server 가 정적 파일을 찾도록.
        NEXT_TELEMETRY_DISABLED: "1",
      },
    });

    this.proc.stdout?.on("data", (c) => this.log.raw("FE/STDOUT", c));
    this.proc.stderr?.on("data", (c) => this.log.raw("FE/STDERR", c));
    this.proc.on("exit", (code, sig) => {
      this.log.warn(`frontend exited code=${code} sig=${sig}`);
    });

    await waitForHttp(`http://127.0.0.1:${this.port}/`, 30_000);
    this.log.info(`frontend healthy at :${this.port}`);
    return { port: this.port };
  }

  stop(): void {
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill("SIGTERM");
      } catch { /* ignore */ }
      this.proc = null;
    }
    this.log.close();
  }
}

/** dev 모드 — backend/frontend 를 띄우지 않고 외부 dev 서버에 붙는다. */
export function devEndpoint(): string {
  return process.env.OPENGOV_DESKTOP_DEV_URL ?? "http://localhost:3000";
}

// silence unused import in ts 5.x
void resourcePath;
