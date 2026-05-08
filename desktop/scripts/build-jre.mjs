#!/usr/bin/env node
// @ts-check
/**
 * jlink 으로 최소 JRE 이미지를 desktop/build/jre 에 생성.
 *
 * 흐름:
 *   1) backend.jar 가 desktop/build/backend/ 에 있는지 확인
 *   2) jdeps 로 모듈 의존 자동 추출 (--ignore-missing-deps + --multi-release 21)
 *   3) jlink 로 strip-debug + compress + no-header-files + no-man-pages 옵션으로 슬림화
 *
 * 결과 크기는 통상 60–90MB — 전체 JDK 의 1/4 수준.
 *
 * 환경:
 *   JAVA_HOME 필수 (JDK 21+).
 *   교차 빌드는 지원 안함 — 각 OS CI 러너가 자기 플랫폼용 JRE 를 만들어야 한다.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");                 // desktop/
const repoRoot = resolve(root, "..");             // 프로젝트 root
const backendDir = join(root, "build", "backend");
const jreOut = join(root, "build", "jre");
const jar = join(backendDir, "backend.jar");

const javaHome = process.env.JAVA_HOME;
if (!javaHome) die("JAVA_HOME 이 설정되지 않았습니다 (JDK 21+ 필요)");

const ext = process.platform === "win32" ? ".exe" : "";
const jdepsBin = join(javaHome, "bin", "jdeps" + ext);
const jlinkBin = join(javaHome, "bin", "jlink" + ext);
if (!existsSync(jdepsBin)) die(`jdeps 가 없습니다: ${jdepsBin}`);
if (!existsSync(jlinkBin)) die(`jlink 가 없습니다: ${jlinkBin}`);

if (!existsSync(jar)) {
  console.log(`[jlink] backend jar 없음 → mvn package 실행 (${jar})`);
  const rc = spawnSync(
    process.platform === "win32" ? "mvn.cmd" : "mvn",
    ["-f", join(repoRoot, "src", "backend", "pom.xml"), "-DskipTests", "package"],
    { stdio: "inherit" },
  );
  if (rc.status !== 0) die(`mvn package 실패 (exit ${rc.status})`);

  // target/*.jar 를 build/backend/backend.jar 로 복사.
  const target = join(repoRoot, "src", "backend", "target");
  const fs = await import("node:fs/promises");
  const files = (await fs.readdir(target)).filter(
    (f) => f.endsWith(".jar") && !f.endsWith("-sources.jar") && !f.endsWith("-javadoc.jar"),
  );
  if (files.length === 0) die("target 에서 jar 를 찾지 못했습니다.");
  // exec/spring-boot fat jar 를 우선 — *original*.jar 는 제외.
  const fat = files.find((f) => !f.startsWith("original-")) ?? files[0];
  mkdirSync(backendDir, { recursive: true });
  await fs.copyFile(join(target, fat), jar);
  console.log(`[jlink] copied ${fat} → ${jar}`);
}

// 1. jdeps 로 모듈 자동 추출.
console.log("[jlink] running jdeps to resolve module set…");
let modulesCsv = "";
try {
  modulesCsv = execFileSync(
    jdepsBin,
    [
      "--print-module-deps",
      "--ignore-missing-deps",
      "--multi-release", "21",
      "--recursive",
      "-q",
      jar,
    ],
    { encoding: "utf8" },
  ).trim();
} catch (e) {
  console.warn(`[jlink] jdeps failed: ${e.message ?? e}`);
}

// jdeps 가 비어 있는 경우 — Spring Boot fat jar 는 nested jar 라 종종 그렇다.
// 그럴 때는 안전한 superset 을 사용한다. Spring Boot 4 + Tomcat + Jackson + SpEL 가
// 런타임 동적 로딩으로 끌어쓰는 모듈을 모두 포함 (HTTPS / JDBC / JNDI / 자동
// 직렬화 / charset / locale / RMI / DNS lookup).
//
// 빠지면 증상이 묘하게 나타나는 모듈 목록:
//   jdk.charsets    → MS949/Cp949 등 비-UTF-8 charset 사용 시 Tomcat 부팅 실패
//   jdk.localedata  → Locale.KOREA / DateTimeFormatter 한글 NPE
//   jdk.naming.dns  → InetAddress / Jackson 일부 deserializer 가 lookup 시 hang/실패
//   jdk.naming.rmi  → JNDI 관련 lookup
//   java.rmi        → JMX / 일부 Spring 4 코드
//   jdk.dynalink    → SpEL / Nashorn 호환 layer
//   jdk.security.auth + jdk.management.agent → 디버거 attach 및 일부 인증 hook
const FALLBACK_MODULES = [
  "java.base",
  "java.compiler",
  "java.datatransfer",
  "java.desktop",
  "java.instrument",
  "java.logging",
  "java.management",
  "java.management.rmi",
  "java.naming",
  "java.net.http",
  "java.prefs",
  "java.rmi",
  "java.scripting",
  "java.security.jgss",
  "java.security.sasl",
  "java.smartcardio",
  "java.sql",
  "java.sql.rowset",
  "java.transaction.xa",
  "java.xml",
  "java.xml.crypto",
  "jdk.charsets",
  "jdk.crypto.cryptoki",
  "jdk.crypto.ec",
  "jdk.dynalink",
  "jdk.httpserver",
  "jdk.jdi",
  "jdk.localedata",
  "jdk.management",
  "jdk.management.agent",
  "jdk.naming.dns",
  "jdk.naming.rmi",
  "jdk.security.auth",
  "jdk.unsupported",
  "jdk.zipfs",
].join(",");

const modules = (modulesCsv && modulesCsv.length > 4 && modulesCsv !== "java.base")
  ? modulesCsv
  : FALLBACK_MODULES;

console.log(`[jlink] modules: ${modules}`);

// 2. 출력 디렉터리 비우기 (jlink 는 이미 존재하면 거부).
if (existsSync(jreOut)) {
  rmSync(jreOut, { recursive: true, force: true });
}

// 3. jlink 실행.
//    --bind-services      : ServiceLoader 로 발견되는 의존 모듈을 자동 포함
//    --include-locales    : jdk.localedata 안의 locale 데이터를 한·영만 남김 (~5MB 절약)
//    --compress=2         : 호환성 좋은 ZIP 압축. JDK 22+ 에서는 zip-6 권장이나
//                          본 프로젝트는 21 LTS 라 2 유지.
console.log(`[jlink] linking minimal JRE → ${jreOut}`);
const rc = spawnSync(
  jlinkBin,
  [
    "--no-header-files",
    "--no-man-pages",
    "--strip-debug",
    "--compress=2",
    "--bind-services",
    "--include-locales=en,ko",
    "--add-modules", modules,
    "--output", jreOut,
  ],
  { stdio: "inherit" },
);
if (rc.status !== 0) die(`jlink 실패 (exit ${rc.status})`);

console.log(`[jlink] OK — ${jreOut}`);

function die(msg) {
  console.error(`[jlink] ${msg}`);
  process.exit(1);
}
