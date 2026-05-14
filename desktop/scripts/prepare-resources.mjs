#!/usr/bin/env node
// @ts-check
/**
 * electron-builder 가 사용할 정적 자원을 desktop/build/{backend,frontend,jre}/ 에 모은다.
 *
 *   - backend  : Spring Boot fat jar
 *   - frontend : Next standalone 산출물 (server.js + .next/static + public)
 *   - jre      : build-jre.mjs 가 만든 jlink 이미지
 *
 * 본 스크립트는 jlink 를 호출하지 않는다 (별도 npm run prepare:jre).
 */

import { existsSync, mkdirSync, cpSync, readdirSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const repoRoot = resolve(root, "..");

const backendOut = join(root, "build", "backend");
const frontendOut = join(root, "build", "frontend");
const jreOut = join(root, "build", "jre");
const llmServiceOut = join(root, "build", "llm-service");
const networkAgentOut = join(root, "build", "network-agent");

mkdirSync(backendOut, { recursive: true });
mkdirSync(frontendOut, { recursive: true });
mkdirSync(llmServiceOut, { recursive: true });
mkdirSync(networkAgentOut, { recursive: true });

// ── backend ──────────────────────────────────────────────────────
const backendJar = join(backendOut, "backend.jar");
const backendTarget = join(repoRoot, "src", "backend", "target");

function findFatJar() {
  if (!existsSync(backendTarget)) return null;
  return readdirSync(backendTarget).find(
    (f) =>
      f.endsWith(".jar") &&
      !f.endsWith(".jar.original") &&
      !f.includes("original-") &&
      !f.endsWith("-sources.jar") &&
      !f.endsWith("-javadoc.jar"),
  ) ?? null;
}

if (!existsSync(backendJar)) {
  let fat = findFatJar();
  if (!fat) {
    console.log("[prepare] target/*.jar 없음 → mvn package 실행");
    // Node 20+ 는 보안상 .cmd 직접 실행을 막음 — Windows 에서는 shell:true 필수.
    const isWin = process.platform === "win32";
    const rc = spawnSync(
      isWin ? "mvn.cmd" : "mvn",
      ["-B", "-f", join(repoRoot, "src", "backend", "pom.xml"), "-DskipTests", "package"],
      { stdio: "inherit", shell: isWin },
    );
    if (rc.status !== 0) {
      console.error("[prepare] mvn package 실패");
      process.exit(1);
    }
    fat = findFatJar();
    if (!fat) {
      console.error("[prepare] target/*.jar 못 찾음");
      process.exit(1);
    }
  }
  copyFileSync(join(backendTarget, fat), backendJar);
  console.log(`[prepare] backend → ${backendJar} (from ${fat})`);
}

// ── frontend (Next standalone) ───────────────────────────────────
const frontendSrc = join(repoRoot, "src", "frontend");
const standaloneDir = join(frontendSrc, ".next", "standalone");
const staticDir = join(frontendSrc, ".next", "static");
const publicDir = join(frontendSrc, "public");

if (!existsSync(standaloneDir)) {
  console.log("[prepare] frontend standalone 빌드가 없음 → npm run build 실행");
  // npm install (필요 시) + npm run build.
  const installRc = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["ci", "--no-audit", "--no-fund", "--loglevel=error"],
    { cwd: frontendSrc, stdio: "inherit" },
  );
  if (installRc.status !== 0) {
    // ci 가 lockfile 미일치로 실패하면 install 로 폴백.
    spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "--no-audit", "--no-fund", "--loglevel=error"],
      { cwd: frontendSrc, stdio: "inherit" },
    );
  }
  const buildRc = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "build"],
    { 
      cwd: frontendSrc, 
      stdio: "inherit",
      env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || "https://tyutya.top" }
    },
  );
  if (buildRc.status !== 0) {
    console.error("[prepare] frontend build 실패");
    process.exit(1);
  }
}

// standalone 트리 통째로 복사.
cpSync(standaloneDir, frontendOut, { recursive: true });
// .next/static + public 은 standalone 안에 포함되지 않음 — 수동 복사.
mkdirSync(join(frontendOut, ".next", "static"), { recursive: true });
cpSync(staticDir, join(frontendOut, ".next", "static"), { recursive: true });
if (existsSync(publicDir)) {
  cpSync(publicDir, join(frontendOut, "public"), { recursive: true });
}
console.log(`[prepare] frontend → ${frontendOut}`);

// ── jre 존재 확인 ────────────────────────────────────────────────
if (!existsSync(jreOut)) {
  console.warn("[prepare] WARN: jre 이미지가 없습니다. `npm run prepare:jre` 를 먼저 실행하세요.");
} else {
  console.log(`[prepare] jre 확인 → ${jreOut}`);
}

// ── python services ──────────────────────────────────────────────
const pythonSrcBase = join(repoRoot, "src");

function copyPythonService(name, outDir) {
  const src = join(pythonSrcBase, name);
  if (!existsSync(src)) {
    console.warn(`[prepare] WARN: ${name} 소스가 없습니다: ${src}`);
    return;
  }
  // __pycache__ 제외
  const filter = (srcPath) => !srcPath.includes("__pycache__");
  cpSync(src, outDir, { recursive: true, filter });
  console.log(`[prepare] ${name} → ${outDir}`);
}

copyPythonService("llm-service", llmServiceOut);
copyPythonService("network-agent", networkAgentOut);

console.log("[prepare] done");
