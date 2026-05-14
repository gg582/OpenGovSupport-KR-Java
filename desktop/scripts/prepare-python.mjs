#!/usr/bin/env node
// @ts-check
/**
 * electron-builder 가 사용할 Python 서비스 의존성을 desktop/build/python-libs/ 에 모은다.
 *
 *   - llm-service 와 network-agent 의 requirements.txt 를 읽어
 *   - pip install --target 으로 공통 라이브러리 폴에 설치.
 *
 * GitHub Actions runner 에는 actions/setup-python 로 Python 3.11+ 가 미리 설치돼 있어야 한다.
 * Windows runner 에도 python/pip 가 PATH 에 있어야 한다.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const repoRoot = resolve(root, "..");

const pythonLibsOut = join(root, "build", "python-libs");
mkdirSync(pythonLibsOut, { recursive: true });

const reqFiles = [
  join(repoRoot, "src", "llm-service", "requirements.txt"),
  join(repoRoot, "src", "network-agent", "requirements.txt"),
];

const py = process.platform === "win32" ? "python" : "python3";

function pipInstall(reqFile) {
  if (!existsSync(reqFile)) {
    console.warn(`[prepare-python] WARN: ${reqFile} 없음 — 건 넘어갑니다.`);
    return;
  }
  console.log(`[prepare-python] pip install -r ${reqFile}`);
  const rc = spawnSync(
    py,
    ["-m", "pip", "install", "-r", reqFile, "--target", pythonLibsOut, "--upgrade"],
    { stdio: "inherit" },
  );
  if (rc.status !== 0) {
    console.error(`[prepare-python] pip install failed for ${reqFile}`);
    process.exit(1);
  }
}

for (const req of reqFiles) {
  pipInstall(req);
}

console.log(`[prepare-python] done → ${pythonLibsOut}`);
