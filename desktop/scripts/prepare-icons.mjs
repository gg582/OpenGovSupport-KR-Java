#!/usr/bin/env node
// @ts-check
/**
 * 아이콘 준비 — repo 루트의 icons/icon.png(고해상도 원본) 으로부터
 *
 *   1) icons/{16x16,32x32,64x64,72x72,96x96,128x128}.png  — 트레이/멀티해상도용
 *   2) desktop/build/icon.png                             — Linux AppImage / electron-builder PNG fallback
 *   3) desktop/build/icon.ico                             — Windows NSIS (멀티해상도 ICO)
 *   4) desktop/build/icon.icns                            — macOS DMG (멀티해상도 ICNS)
 *   5) desktop/build/icons/{...}.png                      — extraResources 로 패키지에 포함되어 트레이가 사용
 *
 * 의존성: sharp(리사이즈) + png2icons(ICO/ICNS 생성). 둘 다 prebuilt 바이너리 또는 순수 JS.
 *
 * 본 스크립트는 prepare-resources.mjs 보다 먼저 / 또는 그 안에서 호출된다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const repoRoot = resolve(root, "..");

const SRC = join(repoRoot, "icons", "icon.png");
const SIZES = [16, 32, 64, 72, 96, 128];

if (!existsSync(SRC)) {
  console.error(`[icons] 원본 PNG 가 없습니다: ${SRC}`);
  process.exit(1);
}

let sharp;
let png2icons;
try {
  sharp = (await import("sharp")).default;
  png2icons = await import("png2icons");
} catch (e) {
  console.error("[icons] sharp / png2icons 미설치 — `npm ci` 또는 `npm install` 후 재시도");
  console.error(`        ${e.message}`);
  process.exit(1);
}

const iconsDir = join(repoRoot, "icons");
const buildDir = join(root, "build");
const buildIconsDir = join(buildDir, "icons");
mkdirSync(iconsDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });
mkdirSync(buildIconsDir, { recursive: true });

// 1) 멀티사이즈 PNG — icons/ 와 desktop/build/icons/ 양쪽에 생성.
for (const sz of SIZES) {
  const buf = await sharp(SRC)
    .resize(sz, sz, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const fname = `${sz}x${sz}.png`;
  writeFileSync(join(iconsDir, fname), buf);
  writeFileSync(join(buildIconsDir, fname), buf);
}
console.log(`[icons] 멀티사이즈 PNG → icons/ + desktop/build/icons/  (${SIZES.join(", ")})`);

// 2) Linux AppImage / electron-builder PNG fallback — 원본을 그대로 복사 (1024+ 권장).
copyFileSync(SRC, join(buildDir, "icon.png"));

// 3) Windows ICO — 멀티해상도(BILINEAR resize 포함).
const srcBuf = readFileSync(SRC);
const ico = png2icons.createICO(srcBuf, png2icons.BILINEAR, 0, false, true);
if (!ico) {
  console.error("[icons] ICO 생성 실패");
  process.exit(1);
}
writeFileSync(join(buildDir, "icon.ico"), ico);

// 4) macOS ICNS — 멀티해상도.
const icns = png2icons.createICNS(srcBuf, png2icons.BILINEAR, 0);
if (!icns) {
  console.error("[icons] ICNS 생성 실패");
  process.exit(1);
}
writeFileSync(join(buildDir, "icon.icns"), icns);

console.log("[icons] desktop/build/{icon.png, icon.ico, icon.icns} 생성 완료");
