/**
 * Linux / FreeBSD AppImage 첫 실행 설치 마법사.
 *
 * 일반 사용자가 AppImage 를 다운로드 받아 더블클릭하면, 본 모듈이 다음을 자동 수행한다:
 *
 *   1) AppImage 가 사용자 영구 위치(~/.local/share/{app}/) 가 아니면 이동·복사
 *   2) {app}.desktop 파일을 ~/.local/share/applications/ 에 작성
 *   3) 아이콘을 ~/.local/share/icons/hicolor/512x512/apps/ 에 등록
 *   4) 언인스톨러 bash 스크립트 + tyutya-uninstall.desktop 메뉴 항목 등록
 *   5) update-desktop-database / xdg-desktop-menu / gtk-update-icon-cache 자동 실행
 *   6) 설치된 사본을 새로 띄우고 현재 인스턴스 종료
 *
 * 사용자가 chmod 하거나 터미널을 열 필요가 없다.
 *
 * 윈도우/맥은 NSIS / DMG 가 자체 설치하므로 본 모듈을 호출하지 않는다.
 */

import { dialog, app, BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, spawnSync } from "child_process";
import { FileLogger } from "../lib/logger";
import { writeUninstaller, UninstallTargets } from "./uninstaller";

type InstallResult =
  | "not-needed"   // 이미 ~/.local/share 안에서 실행 중
  | "skipped"      // 사용자가 거부
  | "relaunched";  // 새 사본을 띄우고 종료해야 함

const APP_DIR_NAME = "tyutya"; // ~/.local/share/tyutya

export async function runFirstRunInstallerIfNeeded(log: FileLogger): Promise<InstallResult> {
  // AppImage 만 처리. 그 외 (예: tar 풀어 직접 실행) 는 그대로 진행.
  const appImagePath = process.env.APPIMAGE;
  const isAppImage = !!appImagePath && fs.existsSync(appImagePath);
  const installRoot = path.join(homedir(), ".local", "share", APP_DIR_NAME);
  const installedAt = path.join(installRoot, path.basename(appImagePath ?? "app.AppImage"));

  if (!isAppImage) {
    log.info("first-run: not an AppImage, skipping wizard");
    return "not-needed";
  }
  if (path.resolve(appImagePath) === path.resolve(installedAt)) {
    log.info("first-run: already running from install dir");
    return "not-needed";
  }
  // 이미 사용자가 직접 ~/.local/share 어딘가에 두었다면 스킵.
  if (appImagePath.startsWith(installRoot)) {
    log.info("first-run: running from within install root");
    return "not-needed";
  }

  log.info(`first-run: AppImage at ${appImagePath} — running install wizard`);

  // 사용자에게 한국어 다이얼로그로 확인.
  const choice = await dialog.showMessageBox({
    type: "question",
    title: "뜌땨 생활행정 — 처음 실행",
    message: "이 프로그램을 컴퓨터에 설치할까요?",
    detail:
      "프로그램을 사용자 폴더(~/.local/share/tyutya)에 복사하고,\n" +
      "응용프로그램 메뉴 · 바탕화면 바로가기를 만듭니다.\n" +
      "관리자 권한이 필요하지 않으며 다른 사용자에게는 영향을 주지 않습니다.\n\n" +
      "[취소] 를 누르면 설치 없이 1회만 실행합니다.",
    buttons: ["설치", "1회만 실행", "종료"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (choice.response === 1) {
    log.info("first-run: user chose run-once");
    return "not-needed";
  }
  if (choice.response === 2) {
    log.info("first-run: user cancelled");
    app.quit();
    return "skipped";
  }

  // 설치 진행 — 진행 윈도우 표시.
  const win = createProgressWindow();
  await win.loadFile(path.join(__dirname, "..", "..", "splash", "splash.html"))
    .catch(() => { /* splash 가 다른 경로일 수 있음 */ });
  await setStage(win, "installing");

  try {
    fs.mkdirSync(installRoot, { recursive: true });

    // 1) AppImage 복사.
    fs.copyFileSync(appImagePath, installedAt);
    fs.chmodSync(installedAt, 0o755);
    log.info(`first-run: copied to ${installedAt}`);

    await setStage(win, "registering");

    // 2) 아이콘 추출/저장.
    const iconDest = path.join(
      homedir(),
      ".local", "share", "icons", "hicolor", "512x512", "apps",
      "tyutya.png",
    );
    fs.mkdirSync(path.dirname(iconDest), { recursive: true });
    const iconSrc = locateIconWithinAppImage(appImagePath);
    if (iconSrc && fs.existsSync(iconSrc)) {
      try { fs.copyFileSync(iconSrc, iconDest); } catch (e) {
        log.warn(`icon copy failed: ${(e as Error).message}`);
      }
    } else {
      // 아이콘을 못 찾으면 빈 파일을 두지 않고 .desktop 의 Icon=tyutya 만 써둔다.
      log.warn("icon not located inside AppImage");
    }

    // 3) .desktop 파일 작성.
    const desktopFile = path.join(
      homedir(), ".local", "share", "applications", "tyutya.desktop",
    );
    fs.mkdirSync(path.dirname(desktopFile), { recursive: true });
    const desktopEntry = [
      "[Desktop Entry]",
      "Type=Application",
      "Name=뜌땨 생활행정",
      "GenericName=Statutory Computation",
      "Comment=결정적 산식 기반 세무·복지 계산기",
      `Exec="${installedAt}" %U`,
      "Icon=tyutya",
      "Categories=Office;Finance;",
      "Terminal=false",
      "StartupWMClass=tyutya",
      `X-AppImage-Version=${app.getVersion()}`,
      "",
    ].join("\n");
    fs.writeFileSync(desktopFile, desktopEntry, { encoding: "utf8", mode: 0o644 });
    log.info(`first-run: wrote ${desktopFile}`);

    // 4) 바탕화면 바로가기 (Desktop 폴더가 있을 때만).
    const desktopDir = xdgUserDir("DESKTOP") ?? path.join(homedir(), "Desktop");
    if (fs.existsSync(desktopDir)) {
      const shortcut = path.join(desktopDir, "tyutya.desktop");
      try {
        fs.copyFileSync(desktopFile, shortcut);
        fs.chmodSync(shortcut, 0o755);
        // GNOME — "trust" 메타데이터.
        runQuiet("gio", ["set", shortcut, "metadata::trusted", "true"]);
      } catch (e) {
        log.warn(`desktop shortcut failed: ${(e as Error).message}`);
      }
    }

    // 5) 언인스톨러 설치 — 본 install root 안에 bash 스크립트 + 메뉴 .desktop 항목.
    //    Electron 자체로 삭제 다이얼로그를 띄우면 자기 자신을 못 지우므로 분리한다.
    const uninstallTargets: UninstallTargets = {
      installRoot,
      appDesktopFile: desktopFile,
      uninstallDesktopFile: path.join(
        homedir(), ".local", "share", "applications", "tyutya-uninstall.desktop",
      ),
      iconFile: iconDest,
      userDataDir: app.getPath("userData"),
      desktopShortcut: fs.existsSync(desktopDir)
        ? path.join(desktopDir, "tyutya.desktop")
        : "",
      selfPath: path.join(installRoot, "tyutya-uninstall.sh"),
    };
    try {
      writeUninstaller(uninstallTargets, app.getVersion());
      log.info(`first-run: wrote uninstaller ${uninstallTargets.selfPath}`);
      log.info(`first-run: wrote uninstaller entry ${uninstallTargets.uninstallDesktopFile}`);
    } catch (e) {
      log.warn(`uninstaller install failed: ${(e as Error).message}`);
    }

    // 6) 데스크톱 데이터베이스 새로고침 — 설치한 즉시 검색에 노출.
    runQuiet("update-desktop-database", [path.dirname(desktopFile)]);
    runQuiet("xdg-desktop-menu", ["forceupdate", "--mode", "user"]);
    runQuiet("gtk-update-icon-cache", [
      "-q", "-t", "-f", path.join(homedir(), ".local", "share", "icons", "hicolor"),
    ]);

    await setStage(win, "done");
    await sleep(400);

    // 7) 설치된 사본을 detached 로 띄우고 현재 인스턴스 종료.
    spawn(installedAt, [], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    }).unref();

    win.destroy();
    return "relaunched";

  } catch (e) {
    log.error(`first-run install failed: ${(e as Error).message}`);
    win.destroy();
    dialog.showErrorBox(
      "설치 실패",
      "프로그램을 설치하지 못했습니다. 한 번만 실행을 시도합니다.\n\n" +
        `사유: ${(e as Error).message}`,
    );
    return "not-needed"; // 그냥 1회 실행 진행
  }
}

function homedir(): string {
  return process.env.HOME ?? os.homedir();
}

/**
 * AppImage 안의 아이콘 추출. AppImage 는 squashfs 라 마운트 없이 직접 못 읽지만,
 * 이미 실행 중이라면 $APPDIR (실행시 자동 마운트된 경로) 에서 .DirIcon / *.png 를 찾는다.
 */
function locateIconWithinAppImage(appImagePath: string): string | null {
  const appdir = process.env.APPDIR;
  if (appdir) {
    const candidates = [
      path.join(appdir, ".DirIcon"),
      path.join(appdir, "tyutya.png"),
      path.join(appdir, "icon.png"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  // appImagePath 자체에서는 추출 못함 — 사용자에게는 기본 X 아이콘이라도 표시됨.
  void appImagePath;
  return null;
}

function xdgUserDir(name: string): string | null {
  // ~/.config/user-dirs.dirs 에서 XDG_DESKTOP_DIR 등을 읽음. 단순 파싱.
  const f = path.join(homedir(), ".config", "user-dirs.dirs");
  if (!fs.existsSync(f)) return null;
  try {
    const txt = fs.readFileSync(f, "utf8");
    const re = new RegExp(`^XDG_${name}_DIR\\s*=\\s*"?([^"\\n]+)"?`, "m");
    const m = re.exec(txt);
    if (!m) return null;
    return m[1].replace("$HOME", homedir());
  } catch {
    return null;
  }
}

function runQuiet(cmd: string, args: string[]): void {
  try {
    spawnSync(cmd, args, { stdio: "ignore", windowsHide: true });
  } catch { /* 명령어 부재여도 무시 — 데스크톱 환경마다 일부 도구가 없음 */ }
}

function createProgressWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 480,
    height: 300,
    show: true,
    frame: false,
    resizable: false,
    backgroundColor: "#0e1116",
    title: "뜌땨 생활행정 설치",
    webPreferences: { sandbox: true, contextIsolation: true },
  });
}

async function setStage(win: BrowserWindow, key: string): Promise<void> {
  try {
    await win.webContents.executeJavaScript(
      `if (typeof window.setStage === 'function') window.setStage(${JSON.stringify(key)});`,
    );
  } catch { /* splash 미로딩 — 무시 */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
