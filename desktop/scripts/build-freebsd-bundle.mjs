#!/usr/bin/env node
// @ts-check
/**
 * FreeBSD 14.2+ 데스크톱 번들러.
 *
 * 호스트가 FreeBSD 인지에 따라 분기:
 *
 *   ▣ NATIVE 모드 (FreeBSD 14.2+ 호스트, CI 의 vmactions/freebsd-vm 안):
 *      pkg 로 설치된 `electron31` 바이너리를 사용해 수동 번들 구성.
 *      이 모드만이 진정한 FreeBSD 네이티브 산출물을 만든다.
 *
 *   ▣ LINUX-COMPAT 모드 (Linux/macOS 호스트):
 *      electron-builder --linux dir 산출물을 그대로 .txz 로 재포장.
 *      FreeBSD 의 linuxulator + linux_base 위에서 동작. 정식 권장 경로는 NATIVE.
 *
 * 어느 경우든 산출물은 desktop/out/Tyutya-freebsd.txz 파일 1개.
 * 풀어쓰면 ~/.local/share/tyutya/ 가 생기고 register.sh 더블클릭으로 등록 완료.
 */

import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync, symlinkSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(root, "out");
mkdirSync(out, { recursive: true });

const isFreeBSD = process.platform === "freebsd";
const mode = isFreeBSD ? "native" : "linux-compat";
console.log(`[freebsd] mode=${mode} (${process.platform}/${process.arch})`);

let unpacked;
if (isFreeBSD) {
  unpacked = await prepareNative();
} else {
  unpacked = await prepareLinuxCompat();
}

// 공통: register.sh + README + tar.xz
const stage = join(out, "freebsd-stage", "tyutya");
mkdirSync(stage, { recursive: true });
cpSyncDir(unpacked, stage);

writeRegisterScript(stage);
writeReadme(stage);

const archive = join(out, `Tyutya-freebsd.txz`);
const tarRc = spawnSync(
  "tar",
  ["-cJf", archive, "-C", join(out, "freebsd-stage"), "tyutya"],
  { stdio: "inherit" },
);
if (tarRc.status !== 0) {
  console.error("[freebsd] tar 실패 — system tar 가 xz 를 지원해야 합니다");
  process.exit(1);
}

const sz = statSync(archive).size;
console.log(`[freebsd] OK — ${archive} (${(sz / 1024 / 1024).toFixed(1)} MB, mode=${mode})`);

// ─── NATIVE: FreeBSD pkg electron31 사용 ─────────────────────────────
async function prepareNative() {
  // 1) pkg 가 설치한 electron 바이너리 위치 탐색.
  const candidates = [
    "/usr/local/bin/electron31",
    "/usr/local/bin/electron30",
    "/usr/local/bin/electron",
  ];
  const electronBin = candidates.find((c) => existsSync(c));
  if (!electronBin) {
    console.error("[freebsd] FreeBSD pkg electron 패키지가 설치되어 있지 않습니다.");
    console.error("   pkg install -y electron31");
    process.exit(1);
  }
  console.log(`[freebsd] using ${electronBin}`);

  // 2) tsc + 자원 준비가 끝나 있는지 확인.
  const distMain = join(root, "dist", "main.js");
  if (!existsSync(distMain)) {
    console.error(`[freebsd] dist/main.js 없음 — 'npm run tsc && npm run prepare:resources' 를 먼저 실행하세요.`);
    process.exit(1);
  }

  // 3) 결과 레이아웃:
  //     tyutya/
  //       tyutya            ← 시작 셸 스크립트
  //       app/                      ← Electron app (package.json + dist + splash + node_modules)
  //       resources/{backend,frontend,jre}
  //       icon.png
  //       LICENSE.txt
  const stageRoot = join(out, "freebsd-native");
  if (existsSync(stageRoot)) rmrf(stageRoot);
  mkdirSync(stageRoot, { recursive: true });

  // electron app 영역 (asar 안 씀 — 단순 unpacked).
  const appDir = join(stageRoot, "app");
  mkdirSync(appDir, { recursive: true });
  copyFileSync(join(root, "package.json"), join(appDir, "package.json"));
  cpSyncDir(join(root, "dist"), join(appDir, "dist"));
  cpSyncDir(join(root, "splash"), join(appDir, "splash"));
  // production node_modules (electron-updater 등) 복사 — devDependencies 는 제외.
  if (existsSync(join(root, "node_modules"))) {
    cpSyncDirFiltered(join(root, "node_modules"), join(appDir, "node_modules"), (p) =>
      !p.includes("/electron/") && !p.includes("/electron-builder/") &&
      !p.includes("/typescript/") && !p.includes("/rimraf/") &&
      !p.endsWith(".d.ts") && !p.endsWith(".map"),
    );
  }

  // 자원 (backend / frontend / jre) — extraResources 와 동일 위치에 복사.
  const resDir = join(stageRoot, "resources");
  mkdirSync(resDir, { recursive: true });
  cpSyncDir(join(root, "build", "backend"), join(resDir, "backend"));
  cpSyncDir(join(root, "build", "frontend"), join(resDir, "frontend"));
  cpSyncDir(join(root, "build", "jre"), join(resDir, "jre"));

  // 아이콘 + 라이선스.
  if (existsSync(join(root, "build", "icon.png"))) {
    copyFileSync(join(root, "build", "icon.png"), join(stageRoot, "icon.png"));
    copyFileSync(join(root, "build", "icon.png"), join(resDir, "icon.png"));
  }
  if (existsSync(join(root, "build", "LICENSE.txt"))) {
    copyFileSync(join(root, "build", "LICENSE.txt"), join(stageRoot, "LICENSE.txt"));
  }

  // 4) 시작 셸 스크립트 — process.resourcesPath 가 ../resources 를 가리키도록 환경 정렬.
  const launcher = `#!/bin/sh
# 누리이음 생활행정 — FreeBSD 네이티브 런처.
set -e
HERE="\${HOME}/.local/share/tyutya"
if [ ! -d "\${HERE}" ]; then
  HERE="$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"
fi
exec "${electronBin}" "\${HERE}/app" --no-sandbox "$@"
`;
  writeFileSync(join(stageRoot, "tyutya"), launcher, { mode: 0o755 });

  return stageRoot;
}

// ─── LINUX-COMPAT: electron-builder --linux dir 위에 얹기 ────────────
async function prepareLinuxCompat() {
  const ebRc = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["electron-builder", "--linux", "dir", "--publish", "never"],
    { cwd: root, stdio: "inherit" },
  );
  if (ebRc.status !== 0) {
    console.error("[freebsd] electron-builder --linux dir 실패");
    process.exit(1);
  }
  const unpacked = join(out, "linux-unpacked");
  if (!existsSync(unpacked)) {
    console.error(`[freebsd] ${unpacked} 가 만들어지지 않았습니다`);
    process.exit(1);
  }
  return unpacked;
}

// ─── helpers ──────────────────────────────────────────────────────────
function writeRegisterScript(stageDir) {
  const installer = `#!/bin/sh
# 누리이음 생활행정 — FreeBSD 등록 스크립트.
# .txz 를 풀어둔 폴더에서 한 번 실행하면 응용프로그램 메뉴 / 검색에 자동 등록됩니다.
set -e
PREFIX="\${HOME}/.local/share/tyutya"
APPS="\${HOME}/.local/share/applications"
ICONS="\${HOME}/.local/share/icons/hicolor/512x512/apps"
mkdir -p "\${APPS}" "\${ICONS}"

# 자기 자신을 영구 위치로 이동(이미 그 위치라면 skip).
SELF="$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"
if [ "\${SELF}" != "\${PREFIX}" ]; then
  mkdir -p "\${PREFIX}"
  cp -a "\${SELF}/." "\${PREFIX}/"
fi

[ -f "\${PREFIX}/icon.png" ] && cp "\${PREFIX}/icon.png" "\${ICONS}/tyutya.png" 2>/dev/null || true

cat > "\${APPS}/tyutya.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=누리이음 생활행정
GenericName=Statutory Computation
Exec="\${PREFIX}/tyutya" %U
Icon=tyutya
Categories=Office;Finance;
Terminal=false
StartupWMClass=tyutya
EOF
chmod 0644 "\${APPS}/tyutya.desktop"

# 데스크톱 데이터베이스 갱신 (없으면 무시).
update-desktop-database "\${APPS}" >/dev/null 2>&1 || true
xdg-desktop-menu forceupdate --mode user >/dev/null 2>&1 || true
gtk-update-icon-cache -q -t -f "\${HOME}/.local/share/icons/hicolor" >/dev/null 2>&1 || true

echo "누리이음 생활행정 — 등록 완료. 응용프로그램 메뉴에서 실행하세요."
`;
  writeFileSync(join(stageDir, "register.sh"), installer, { mode: 0o755 });
}

function writeReadme(stageDir) {
  const readme = `누리이음 생활행정 — FreeBSD 번들

설치 (3단계, 모두 GUI):
  1) 이 .txz 를 임의 위치에 풉니다.
  2) 풀린 'tyutya' 폴더 안의 'register.sh' 를 더블클릭 (한 번만).
  3) 응용프로그램 메뉴에서 "누리이음 생활행정" 을 더블클릭하면 실행됩니다.

요구사항:
  - FreeBSD 14.2+ (네이티브 빌드 — 별도 의존 없음)
  - 또는 13.x (Linuxulator + linux_base 활성, linux-compat 빌드 사용 시)
  - JRE 별도 설치 불필요 — jlink 최소 런타임이 번들에 포함되어 있습니다.

제거:
  rm -rf ~/.local/share/tyutya ~/.local/share/applications/tyutya.desktop

산출물 검증:
  pkg install -y electron31 가 설치된 FreeBSD 14.2 환경에서 빌드됨.
`;
  writeFileSync(join(stageDir, "README.txt"), readme);
}

function cpSyncDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    const st = statSync(s, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) cpSyncDir(s, d);
    else if (st.isSymbolicLink()) {
      try {
        const linkTarget = readlink(s);
        symlinkSync(linkTarget, d);
      } catch { copyFileSync(s, d); }
    }
    else copyFileSync(s, d);
  }
}

function cpSyncDirFiltered(src, dst, accept) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    const st = statSync(s, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) {
      if (accept(s)) cpSyncDirFiltered(s, d, accept);
    } else if (accept(s)) {
      copyFileSync(s, d);
    }
  }
}

function readlink(p) {
  return readFileSync(p, { encoding: "utf8" });
}

function rmrf(p) {
  spawnSync(process.platform === "win32" ? "cmd" : "rm", process.platform === "win32" ? ["/c", "rd", "/s", "/q", p] : ["-rf", p]);
}
