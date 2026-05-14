import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  backendJar,
  frontendEntry,
  javaBin,
  jreRoot,
  pythonBin,
  llmServiceEntry,
  networkAgentEntry,
  pythonLibsPath,
  dataDir,
  logsDir,
  userDataDir,
} from "./paths";
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
 *
 * 실패 시: 자식이 헬스체크 통과 전에 죽으면 `start()` 의 Promise 가 즉시 reject.
 *          stderr 의 마지막 ~30 줄은 Error.message 에 포함되어 main 프로세스가
 *          사용자 다이얼로그에 부분 노출할 수 있게 한다.
 */

/** stderr 의 마지막 N 줄을 보관하는 링 버퍼. */
class TailBuffer {
  private readonly cap: number;
  private readonly lines: string[] = [];
  constructor(cap = 30) { this.cap = cap; }
  push(chunk: Buffer | string): void {
    const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (const line of s.split(/\r?\n/)) {
      if (!line) continue;
      this.lines.push(line);
      if (this.lines.length > this.cap) this.lines.shift();
    }
  }
  text(): string { return this.lines.join("\n"); }
}

/**
 * 자식 프로세스에 노출할 환경변수 화이트리스트. 호스트의 PORT/BACKEND_URL/SSL_*
 * 등을 그대로 물려주면 백엔드/프런트가 의도와 다른 포트에 묶이거나 SSL 을 켜
 * 시작 자체가 실패할 수 있다. PATH/LANG/HOME 등 OS 가 필요로 하는 최소만 통과.
 */
function safeEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const passthrough = [
    "PATH",
    "HOME",
    "USER",
    "USERPROFILE",
    "USERNAME",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "SystemDrive",
    "windir",
    "ComSpec",
    "PATHEXT",
  ];
  const out: NodeJS.ProcessEnv = {};
  for (const k of passthrough) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  return { ...out, ...extra };
}

/**
 * JRE 트리의 실행 권한을 보강. extraResources 로 복사된 native 바이너리가
 * 실행 비트를 잃은 경우(특히 readonly fs 는 제외) 다시 0o755 로 정렬.
 */
function ensureJreExecutable(): void {
  if (process.platform === "win32") return;
  const root = jreRoot();
  const targets = [
    path.join(root, "bin"),
    path.join(root, "lib"),
  ];
  for (const dir of targets) {
    if (!fs.existsSync(dir)) continue;
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const p = path.join(dir, name);
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { continue; }
      if (!st.isFile()) continue;
      // bin/* 는 모두 실행. lib/jspawnhelper, lib/jexec 만 lib 에서 실행.
      const isExecCandidate =
        dir.endsWith("bin") ||
        name === "jspawnhelper" ||
        name === "jexec" ||
        /\.(so|dylib|jnilib)(\.\d+)*$/.test(name);
      if (!isExecCandidate) continue;
      try { fs.chmodSync(p, 0o755); } catch { /* readonly fs (AppImage 등) */ }
    }
  }
}

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

    // JRE 트리 전체 권한 보강 (afterPack 이 한 번 처리하지만, 사용자가 압축
    // 해제 등으로 권한을 깎았을 가능성 대비 런타임에서도 한 번 더).
    ensureJreExecutable();

    // 임시 폴더 + 로그 폴더 미리 생성.
    const tmpDir = path.join(userDataDir(), "temp");
    fs.mkdirSync(tmpDir, { recursive: true });

    const args = [
      "-Xmx512m",
      "-XX:+UseG1GC",
      "-Dfile.encoding=UTF-8",
      "-Djava.awt.headless=true",
      "-Dspring.main.banner-mode=off",
      // application.yml 의 ${PORT:443} placeholder 를 무시하고 임의 포트 강제.
      // command-line system property 는 yml 보다 우선순위가 높다.
      `-Dserver.port=${this.port}`,
      "-Dserver.ssl.enabled=false",
      // 데스크톱은 reverse proxy 가 없으므로 internal-port 도 같은 임의 포트로 통일.
      `-Dserver.internal-port=${this.port}`,
      `-Duser.home=${process.env.HOME ?? process.env.USERPROFILE ?? ""}`,
      `-Dopengov.data.dir=${dataDir()}`,
      // 임시 폴더도 사용자 영역으로 격리 (일부 환경에서 /tmp 쓰기 제한 대응).
      `-Djava.io.tmpdir=${tmpDir}`,
      // Spring Boot 4 + Java 21 의 native API 경고 억제.
      "--enable-native-access=ALL-UNNAMED",
      "-jar",
      jar,
    ];

    this.log.info(`spawning backend: ${java} ${args.join(" ")}`);

    this.proc = spawn(java, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      cwd: path.dirname(jar),
      env: safeEnv({
        OPENGOV_DESKTOP: "1",
        // 호스트 PORT 환경변수가 새는 경우를 대비해 명시적으로 임의 포트 주입.
        PORT: String(this.port),
        SSL_ENABLED: "false",
      }),
    });

    const tail = new TailBuffer(40);
    this.proc.stdout?.on("data", (c) => this.log.raw("BE/STDOUT", c));
    this.proc.stderr?.on("data", (c) => {
      tail.push(c);
      this.log.raw("BE/STDERR", c);
    });
    this.proc.on("error", (err) => {
      this.log.error(`backend spawn error: ${err.message}`);
    });

    // 헬스체크와 프로세스 종료를 race — 어느 쪽이 먼저 끝나든 그 결과로 판정.
    let died: { code: number | null; sig: NodeJS.Signals | null } | null = null;
    const exitWatch = new Promise<void>((_resolve, reject) => {
      this.proc?.once("exit", (code, sig) => {
        died = { code, sig };
        this.log.warn(`backend exited code=${code} sig=${sig}`);
        reject(new Error(
          `백엔드가 시작 도중 종료되었습니다 (code=${code} sig=${sig}).\n` +
          (tail.text() ? `최근 stderr:\n${tail.text()}` : ""),
        ));
      });
    });

    try {
      await Promise.race([
        waitForHttp(`http://localhost:${this.port}/api/health`, 90_000),
        exitWatch,
      ]);
    } catch (e) {
      // 프로세스가 살아있다면 정리.
      if (!died) this.stop();
      const msg = (e as Error).message;
      throw new Error(msg + (died ? "" : `\n\n로그: ${this.log.path()}`));
    }

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
      env: safeEnv({
        ELECTRON_RUN_AS_NODE: "1",     // Electron 을 순수 node 로 실행
        PORT: String(this.port),
        HOSTNAME: "localhost",
        NODE_ENV: "production",
        BACKEND_URL: `http://localhost:${backendPort}`,
        OPENGOV_DESKTOP: "1",
        // standalone server 가 정적 파일을 찾도록.
        NEXT_TELEMETRY_DISABLED: "1",
      }),
    });

    const tail = new TailBuffer(40);
    this.proc.stdout?.on("data", (c) => this.log.raw("FE/STDOUT", c));
    this.proc.stderr?.on("data", (c) => {
      tail.push(c);
      this.log.raw("FE/STDERR", c);
    });
    this.proc.on("error", (err) => {
      this.log.error(`frontend spawn error: ${err.message}`);
    });

    let died: { code: number | null; sig: NodeJS.Signals | null } | null = null;
    const exitWatch = new Promise<void>((_resolve, reject) => {
      this.proc?.once("exit", (code, sig) => {
        died = { code, sig };
        this.log.warn(`frontend exited code=${code} sig=${sig}`);
        reject(new Error(
          `프런트엔드가 시작 도중 종료되었습니다 (code=${code} sig=${sig}).\n` +
          (tail.text() ? `최근 stderr:\n${tail.text()}` : ""),
        ));
      });
    });

    try {
      await Promise.race([
        waitForHttp(`http://localhost:${this.port}/`, 30_000),
        exitWatch,
      ]);
    } catch (e) {
      if (!died) this.stop();
      throw new Error((e as Error).message + (died ? "" : `\n\n로그: ${this.log.path()}`));
    }

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

export class LlmService {
  private proc: ChildProcess | null = null;
  private readonly log: FileLogger;
  port = 0;

  constructor() {
    this.log = new FileLogger(logsDir(), "llm-service");
  }

  async start(backendPort: number): Promise<{ port: number }> {
    this.port = await findFreePort();
    const py = pythonBin();
    const entry = llmServiceEntry();
    const cwd = path.dirname(entry);

    if (!fs.existsSync(entry)) {
      throw new Error(`LLM 서비스를 찾지 못했습니다: ${entry}`);
    }

    this.log.info(`spawning llm-service: ${py} -m uvicorn main:app --port ${this.port} --host 127.0.0.1`);

    const pyLibs = pythonLibsPath();
    this.proc = spawn(py, ["-m", "uvicorn", "main:app", "--port", String(this.port), "--host", "127.0.0.1"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      cwd,
      env: safeEnv({
        OPENGOV_DESKTOP: "1",
        PORT: String(this.port),
        BASE_URL: `http://localhost:${backendPort}`,
        PYTHONPATH: pyLibs,
      }),
    });

    const tail = new TailBuffer(40);
    this.proc.stdout?.on("data", (c) => this.log.raw("LLM/STDOUT", c));
    this.proc.stderr?.on("data", (c) => {
      tail.push(c);
      this.log.raw("LLM/STDERR", c);
    });
    this.proc.on("error", (err) => {
      this.log.error(`llm-service spawn error: ${err.message}`);
    });

    let died: { code: number | null; sig: NodeJS.Signals | null } | null = null;
    const exitWatch = new Promise<void>((_resolve, reject) => {
      this.proc?.once("exit", (code, sig) => {
        died = { code, sig };
        this.log.warn(`llm-service exited code=${code} sig=${sig}`);
        reject(new Error(
          `LLM 서비스가 시작 도중 종료되었습니다 (code=${code} sig=${sig}).\n` +
          (tail.text() ? `최근 stderr:\n${tail.text()}` : ""),
        ));
      });
    });

    try {
      await Promise.race([
        waitForHttp(`http://127.0.0.1:${this.port}/`, 90_000),
        exitWatch,
      ]);
    } catch (e) {
      if (!died) this.stop();
      throw new Error((e as Error).message + (died ? "" : `\n\n로그: ${this.log.path()}`));
    }

    this.log.info(`llm-service healthy at :${this.port}`);
    return { port: this.port };
  }

  stop(): void {
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill("SIGTERM"); } catch { /* ignore */ }
      this.proc = null;
    }
    this.log.close();
  }
}

export class NetworkAgent {
  private proc: ChildProcess | null = null;
  private readonly log: FileLogger;
  port = 0;

  constructor() {
    this.log = new FileLogger(logsDir(), "network-agent");
  }

  async start(backendPort: number, llmPort: number): Promise<{ port: number }> {
    this.port = await findFreePort();
    const py = pythonBin();
    const entry = networkAgentEntry();
    const cwd = path.dirname(entry);

    if (!fs.existsSync(entry)) {
      throw new Error(`Network Agent를 찾지 못했습니다: ${entry}`);
    }

    this.log.info(`spawning network-agent: ${py} -m uvicorn main:app --port ${this.port} --host 127.0.0.1`);

    const pyLibs = pythonLibsPath();
    this.proc = spawn(py, ["-m", "uvicorn", "main:app", "--port", String(this.port), "--host", "127.0.0.1"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      cwd,
      env: safeEnv({
        OPENGOV_DESKTOP: "1",
        PORT: String(this.port),
        BASE_URL: `http://localhost:${backendPort}`,
        LLM_SERVICE_URL: `http://localhost:${llmPort}`,
        PYTHONPATH: pyLibs,
      }),
    });

    const tail = new TailBuffer(40);
    this.proc.stdout?.on("data", (c) => this.log.raw("NA/STDOUT", c));
    this.proc.stderr?.on("data", (c) => {
      tail.push(c);
      this.log.raw("NA/STDERR", c);
    });
    this.proc.on("error", (err) => {
      this.log.error(`network-agent spawn error: ${err.message}`);
    });

    let died: { code: number | null; sig: NodeJS.Signals | null } | null = null;
    const exitWatch = new Promise<void>((_resolve, reject) => {
      this.proc?.once("exit", (code, sig) => {
        died = { code, sig };
        this.log.warn(`network-agent exited code=${code} sig=${sig}`);
        reject(new Error(
          `Network Agent가 시작 도중 종료되었습니다 (code=${code} sig=${sig}).\n` +
          (tail.text() ? `최근 stderr:\n${tail.text()}` : ""),
        ));
      });
    });

    try {
      await Promise.race([
        waitForHttp(`http://127.0.0.1:${this.port}/`, 90_000),
        exitWatch,
      ]);
    } catch (e) {
      if (!died) this.stop();
      throw new Error((e as Error).message + (died ? "" : `\n\n로그: ${this.log.path()}`));
    }

    this.log.info(`network-agent healthy at :${this.port}`);
    return { port: this.port };
  }

  stop(): void {
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill("SIGTERM"); } catch { /* ignore */ }
      this.proc = null;
    }
    this.log.close();
  }
}
