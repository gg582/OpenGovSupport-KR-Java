import { app } from "electron";
import * as path from "path";
import * as fs from "fs";

/**
 * 데스크톱 모드의 디렉터리 구조 — 모든 경로는 사용자 영역(per-user) 으로 격리.
 * /opt, /usr, /root, %ProgramFiles% 등 시스템 영역에 절대 쓰지 않는다.
 *
 * - userData       : Electron 표준 — 설정·로그·DB
 * - resources      : electron-builder 가 패키징한 정적 자원 (JRE / backend / frontend)
 * - dataDir        : 그래프 JSON 등 사용자 산출물
 * - logsDir        : 백엔드/프런트/메인 로그
 */
export function userDataDir(): string {
  return app.getPath("userData");
}

export function dataDir(): string {
  const d = path.join(userDataDir(), "data");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function logsDir(): string {
  const d = path.join(userDataDir(), "logs");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function configFile(): string {
  return path.join(userDataDir(), "config.json");
}

export function isDev(): boolean {
  return process.env.OPENGOV_DESKTOP_DEV === "1" || !app.isPackaged;
}

/**
 * extraResources 로 함께 묶인 정적 자원의 절대경로.
 * 개발(dev) 모드에서는 desktop/build/{kind} 를 가리킨다.
 */
export function resourcePath(kind: "backend" | "frontend" | "jre" | "icons"): string {
  if (isDev()) {
    return path.join(__dirname, "..", "build", kind);
  }
  return path.join(process.resourcesPath, kind);
}

/** 트레이/창 아이콘 — 플랫폼별 적절한 사이즈 PNG 로 폴백 체인. */
export function trayIconPath(): string {
  const dir = resourcePath("icons");
  // Windows/Linux 트레이는 16~32, macOS 메뉴바는 22 가 표준 — 32 가 양쪽 모두 큰 문제 없음.
  // 작은 사이즈가 없으면 큰 쪽으로 폴백.
  const candidates =
    process.platform === "darwin"
      ? ["32x32.png", "16x16.png", "64x64.png"]
      : ["32x32.png", "64x64.png", "16x16.png"];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return path.join(dir, "32x32.png");
}

export function windowIconPath(): string {
  const dir = resourcePath("icons");
  for (const c of ["128x128.png", "96x96.png", "64x64.png"]) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return path.join(dir, "128x128.png");
}

/** 플랫폼별 java 실행 파일 경로 (jlink JRE 내부). */
export function javaBin(): string {
  const jre = jreRoot();
  return process.platform === "win32"
    ? path.join(jre, "bin", "java.exe")
    : path.join(jre, "bin", "java");
}

/**
 * jlink 결과는 통상 단순 폴더이지만, macOS 에서 향후 `Contents/Home` 구조를 끼워
 * 넣게 될 가능성을 대비한 분기. bin/java(.exe) 가 곧장 보이면 그 폴더를, 아니면
 * Contents/Home 을 시도.
 */
export function jreRoot(): string {
  const root = resourcePath("jre");
  const exe = process.platform === "win32" ? "java.exe" : "java";
  if (fs.existsSync(path.join(root, "bin", exe))) return root;
  const macHome = path.join(root, "Contents", "Home");
  if (fs.existsSync(path.join(macHome, "bin", exe))) return macHome;
  return root;
}

/** Spring Boot 백엔드 fat jar 경로. */
export function backendJar(): string {
  return path.join(resourcePath("backend"), "backend.jar");
}

/** Next standalone 서버 진입점 (server.js). */
export function frontendEntry(): string {
  return path.join(resourcePath("frontend"), "server.js");
}
