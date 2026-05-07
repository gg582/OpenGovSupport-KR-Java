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
export function resourcePath(kind: "backend" | "frontend" | "jre"): string {
  if (isDev()) {
    return path.join(__dirname, "..", "build", kind);
  }
  return path.join(process.resourcesPath, kind);
}

/** 플랫폼별 java 실행 파일 경로 (jlink JRE 내부). */
export function javaBin(): string {
  const jre = resourcePath("jre");
  return process.platform === "win32"
    ? path.join(jre, "bin", "java.exe")
    : path.join(jre, "bin", "java");
}

/** Spring Boot 백엔드 fat jar 경로. */
export function backendJar(): string {
  return path.join(resourcePath("backend"), "backend.jar");
}

/** Next standalone 서버 진입점 (server.js). */
export function frontendEntry(): string {
  return path.join(resourcePath("frontend"), "server.js");
}
