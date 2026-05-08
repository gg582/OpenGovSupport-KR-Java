// @ts-check
/**
 * electron-builder afterPack 후크.
 *
 * extraResources 로 복사된 JRE 트리는 일부 환경(특히 Linux→Windows 교차 또는
 * macOS hardenedRuntime) 에서 실행 권한이 풀린 채로 패킹된다. java 가
 * lib/jspawnhelper 등을 spawn 해야 하므로 모든 native 바이너리에 0o755 를
 * 다시 부여해 둔다.
 *
 * macOS 의 경우 quarantine 확장속성 (com.apple.quarantine) 을 일괄 제거 — 그래야
 * Gatekeeper 가 자식 프로세스 실행을 차단하지 않는다. 정식 codesign 은 별도
 * 단계에서 수행한다 (본 후크는 권한·xattr 만 다룸).
 *
 * 본 후크는 NSIS / DMG / AppImage 산출물 자체를 변경하지 않는다 — extraResources
 * 만 손댄다.
 */

import { existsSync, statSync, chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    if (!d) continue;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out;
}

/** @param {string} resourcesDir */
function fixJre(resourcesDir, electronPlatformName) {
  const jre = join(resourcesDir, "jre");
  if (!existsSync(jre)) {
    console.log(`[afterPack] no jre at ${jre} — skipping`);
    return;
  }

  // bin/* : 모두 실행 가능해야 함.
  const binDir = join(jre, "bin");
  if (existsSync(binDir)) {
    for (const f of readdirSync(binDir)) {
      const p = join(binDir, f);
      try {
        chmodSync(p, 0o755);
      } catch (e) {
        console.warn(`[afterPack] chmod failed ${p}: ${e?.message ?? e}`);
      }
    }
  }

  // lib/jspawnhelper, lib/jexec — POSIX 에서 JVM 이 fork-exec 시 사용.
  for (const rel of ["lib/jspawnhelper", "lib/jexec"]) {
    const p = join(jre, rel);
    if (existsSync(p)) {
      try { chmodSync(p, 0o755); } catch { /* readonly fs */ }
    }
  }

  // .so / .dylib / .jnilib — 실행 권한이 없어도 dlopen 은 되지만, 일부 보안 모듈이
  // r-x 를 요구하므로 일괄 0o755 로 정렬 (Windows .dll 은 NTFS 권한 무관).
  if (electronPlatformName !== "win32") {
    for (const f of walk(jre)) {
      if (/\.(so|dylib|jnilib)(\.\d+)*$/.test(f)) {
        try { chmodSync(f, 0o755); } catch { /* ignore */ }
      }
    }
  }

  // macOS — JRE 트리에서 quarantine 확장속성 제거. xattr 가 없는 환경(linux 빌더에서
  // mac 산출물 만들기) 에서는 무시.
  if (electronPlatformName === "darwin") {
    const rc = spawnSync("xattr", ["-cr", jre], { stdio: "ignore" });
    if (rc.status !== 0) {
      console.warn("[afterPack] xattr -cr 실패 — Gatekeeper 차단 가능. macOS 빌더에서 다시 실행 권장.");
    }
  }

  console.log(`[afterPack] JRE 권한 정리 완료 (${electronPlatformName}) — ${jre}`);
}

/**
 * @param {{
 *   appOutDir: string,
 *   electronPlatformName: string,
 *   packager: { platform: { buildConfigurationKey: string } }
 * }} ctx
 */
export default async function afterPack(ctx) {
  const { appOutDir, electronPlatformName } = ctx;

  // 플랫폼별로 resources 폴더 위치가 다르다.
  //   linux/win  : <appOutDir>/resources
  //   mac        : <appOutDir>/<AppName>.app/Contents/Resources
  let resourcesDir = join(appOutDir, "resources");
  if (electronPlatformName === "darwin" || electronPlatformName === "mas") {
    // mac 산출물은 .app 안. 정확한 .app 이름은 productName 인데, 디렉터리 스캔으로 찾는다.
    let appBundle = "";
    try {
      const entries = readdirSync(appOutDir);
      appBundle = entries.find((e) => e.endsWith(".app")) ?? "";
    } catch { /* ignore */ }
    if (appBundle) {
      resourcesDir = join(appOutDir, appBundle, "Contents", "Resources");
    }
  }

  if (!existsSync(resourcesDir) || !statSync(resourcesDir).isDirectory()) {
    console.warn(`[afterPack] resources dir not found at ${resourcesDir}`);
    return;
  }

  fixJre(resourcesDir, electronPlatformName);
}
