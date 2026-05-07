/**
 * Electron 메인 프로세스 — 데스크톱 앱의 부팅 시퀀스.
 *
 *   splash 표시
 *      → (Linux/FreeBSD 한정) 첫 실행이면 install wizard
 *      → 백엔드 자식 프로세스 (Java) 기동
 *      → 프런트 자식 프로세스 (Next standalone) 기동
 *      → 헬스체크 통과 시 splash → 실제 UI 로 전환
 *
 * 모든 자식 프로세스 출력은 ~/.config/{app}/logs/*.log 에 누적.
 * 사용자에게 터미널·예외 스택은 절대 노출하지 않는다.
 */

import { app, BrowserWindow, dialog, Menu, shell, ipcMain, Tray, nativeImage } from "electron";
import * as fs from "fs";
import * as path from "path";
import { autoUpdater } from "electron-updater";
import { Backend, Frontend, devEndpoint } from "./lib/processes";
import { FileLogger } from "./lib/logger";
import { logsDir, isDev, trayIconPath, windowIconPath } from "./lib/paths";
import { runFirstRunInstallerIfNeeded } from "./installer/firstRun";

const log = new FileLogger(logsDir(), "main");
const backend = new Backend();
const frontend = new Frontend();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** 트레이 메뉴의 "종료" 또는 OS 가 정말 종료를 요청한 경우에만 true. */
let isQuitting = false;

// 동시 실행 방지 — 두 인스턴스가 같은 포트를 다투지 않도록.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// 사용자에게 끔찍한 자바 스택트레이스 대신 한국어 다이얼로그.
process.on("uncaughtException", (err) => {
  log.error(`uncaught: ${err.stack ?? err.message}`);
  try {
    dialog.showErrorBox(
      "예기치 않은 오류",
      "프로그램에서 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.\n\n자세한 로그는 [설정 → 고급 → 로그 폴더] 에서 확인할 수 있습니다.",
    );
  } catch { /* dialog might not be ready yet */ }
});

app.whenReady().then(boot).catch((e) => {
  log.error(`boot failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  dialog.showErrorBox(
    "시작 실패",
    "프로그램을 시작하지 못했습니다. 컴퓨터를 재시작한 후 다시 시도해 주세요.",
  );
  app.quit();
});

app.on("window-all-closed", () => {
  // 트레이가 살아있으면 백그라운드 동작 — 진짜 종료는 트레이의 '종료' 메뉴로만.
  if (!tray || isQuitting) {
    shutdown();
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  shutdown();
});

app.on("activate", () => {
  // macOS dock 클릭 시 창 복원.
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

async function boot(): Promise<void> {
  log.info(`boot — version ${app.getVersion()} platform=${process.platform} arch=${process.arch}`);

  // Linux/FreeBSD: AppImage 첫 실행 시 self-install (사용자가 chmod 모르게).
  if (process.platform === "linux" || process.platform === "freebsd") {
    const installed = await runFirstRunInstallerIfNeeded(log);
    if (installed === "relaunched") {
      // 설치된 사본이 새로 떠올라가므로 현재 인스턴스는 종료.
      app.quit();
      return;
    }
  }

  Menu.setApplicationMenu(buildMenu());

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: true,
    backgroundColor: "#0e1116",
    title: "뜌땨 생활행정",
    icon: tryLoadIcon(windowIconPath()),
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (process.platform !== "darwin") {
    mainWindow.setMenuBarVisibility(false);
  }

  // 트레이 부팅 — 창보다 먼저 만들어 두면 창을 숨겨도 앱이 살아있다.
  setupTray();

  // 창 닫기(X) → 종료가 아니라 트레이로 숨김. 진짜 종료는 트레이/메뉴의 '종료'.
  mainWindow.on("close", (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  // 외부 링크는 OS 기본 브라우저로.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // splash — asar unpack 영역에서 로드 (file:// 직접).
  const splashPath = isDev()
    ? path.join(__dirname, "..", "splash", "splash.html")
    : path.join(process.resourcesPath, "..", "splash", "splash.html");
  await mainWindow.loadFile(splashPath).catch(async () => {
    // fallback — asar 안에 있을 수도 있음.
    await mainWindow!.loadFile(path.join(__dirname, "..", "splash", "splash.html"));
  });

  await stage("starting-engine");

  if (isDev() && process.env.OPENGOV_DESKTOP_DEV_URL) {
    // 외부 dev 서버 연결 모드.
    await stage("launching-dashboard");
    await mainWindow.loadURL(`${devEndpoint()}/dashboard`);
    return;
  }

  // 1) 백엔드 기동.
  let backendPort = 0;
  try {
    const r = await backend.start();
    backendPort = r.port;
  } catch (e) {
    log.error(`backend start failed: ${(e as Error).message}`);
    dialog.showErrorBox(
      "엔진 시작 실패",
      "내부 계산 엔진을 시작하지 못했습니다. 프로그램을 다시 실행해 주세요.",
    );
    app.quit();
    return;
  }

  // 2) 프런트엔드 기동.
  await stage("starting-ui");
  let frontendPort = 0;
  try {
    const r = await frontend.start(backendPort);
    frontendPort = r.port;
  } catch (e) {
    log.error(`frontend start failed: ${(e as Error).message}`);
    dialog.showErrorBox(
      "화면 시작 실패",
      "사용자 인터페이스를 시작하지 못했습니다. 프로그램을 다시 실행해 주세요.",
    );
    app.quit();
    return;
  }

  // 3) 실제 UI 로 전환.
  await stage("launching-dashboard");
  await mainWindow.loadURL(`http://127.0.0.1:${frontendPort}/dashboard`);

  // 자동 업데이트 — 패키징된 모드에서만 시도.
  if (!isDev()) {
    setTimeout(() => {
      try {
        autoUpdater.checkForUpdatesAndNotify().catch((e) => {
          log.warn(`auto-update check failed: ${(e as Error).message}`);
        });
      } catch { /* publish 미설정 시 조용히 패스 */ }
    }, 5_000);
  }

  // IPC — 렌더러가 advanced 정보를 요청할 수 있도록.
  ipcMain.handle("opengov:status", () => ({
    version: app.getVersion(),
    platform: process.platform,
    backendPort,
    frontendPort,
    logsDir: logsDir(),
  }));
  ipcMain.handle("opengov:openLogs", () => shell.openPath(logsDir()));
  ipcMain.handle("opengov:saveFile", async (_, { content, filename }: { content: string; filename: string }) => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: filename,
      filters: [
        { name: "Shell Scripts", extensions: ["sh", "zsh", "ps1"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.writeFile(result.filePath, content, "utf-8");
    return { canceled: false, filePath: result.filePath };
  });
}

async function stage(s: string): Promise<void> {
  if (!mainWindow) return;
  try {
    await mainWindow.webContents.executeJavaScript(
      `if (typeof window.setStage === 'function') window.setStage(${JSON.stringify(s)});`,
      true,
    );
  } catch { /* splash 가 아닐 수 있음 */ }
}

function shutdown(): void {
  log.info("shutdown");
  backend.stop();
  frontend.stop();
  if (tray) {
    try { tray.destroy(); } catch { /* already destroyed */ }
    tray = null;
  }
}

function tryLoadIcon(p: string): Electron.NativeImage | undefined {
  try {
    const img = nativeImage.createFromPath(p);
    return img.isEmpty() ? undefined : img;
  } catch {
    return undefined;
  }
}

function setupTray(): void {
  const iconPath = trayIconPath();
  const img = tryLoadIcon(iconPath);
  if (!img) {
    log.warn(`tray: icon not found at ${iconPath} — 트레이 비활성화`);
    return;
  }
  // macOS 메뉴바는 템플릿 이미지(검정+알파)가 표준 — 없으면 컬러로 표시되어도 동작은 함.
  if (process.platform === "darwin") img.setTemplateImage(true);

  try {
    tray = new Tray(img);
  } catch (e) {
    log.warn(`tray: 생성 실패 (${(e as Error).message}) — 일부 Linux DE(GNOME 등) 는 별도 확장 필요`);
    return;
  }

  tray.setToolTip("뜌땨 생활행정");
  tray.setContextMenu(buildTrayMenu());

  // 트레이 클릭/더블클릭 → 창 토글 (Linux 의 일부 DE 는 click 이벤트가 없을 수 있어 둘 다 바인딩).
  const toggle = (): void => {
    if (!mainWindow) return;
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  };
  tray.on("click", toggle);
  tray.on("double-click", toggle);
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: "창 보이기",
      click: () => {
        if (!mainWindow) return;
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: "창 숨기기",
      click: () => mainWindow?.hide(),
    },
    { type: "separator" },
    {
      label: "로그 폴더 열기",
      click: () => shell.openPath(logsDir()),
    },
    {
      label: "버전 정보",
      click: () => {
        dialog.showMessageBox({
          type: "info",
          title: "버전 정보",
          message: app.getName(),
          detail: `버전 ${app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}`,
        });
      },
    },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function buildMenu(): Menu {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" as const },
            { type: "separator" as const },
            { role: "services" as const },
            { type: "separator" as const },
            { role: "hide" as const },
            { role: "hideOthers" as const },
            { role: "unhide" as const },
            { type: "separator" as const },
            { role: "quit" as const },
          ],
        }]
      : []),
    {
      label: "파일",
      submenu: [
        {
          label: "트레이로 숨기기",
          accelerator: "CmdOrCtrl+H",
          click: () => mainWindow?.hide(),
        },
        { type: "separator" as const },
        {
          label: "종료",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "보기",
      submenu: [
        { role: "reload" as const, label: "새로 고침" },
        { role: "forceReload" as const, label: "강제 새로 고침" },
        { type: "separator" as const },
        { role: "resetZoom" as const, label: "확대 초기화" },
        { role: "zoomIn" as const, label: "확대" },
        { role: "zoomOut" as const, label: "축소" },
        { type: "separator" as const },
        { role: "togglefullscreen" as const, label: "전체 화면" },
      ],
    },
    {
      label: "고급",
      submenu: [
        {
          label: "로그 폴더 열기",
          click: () => shell.openPath(logsDir()),
        },
        {
          label: "버전 정보",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "버전 정보",
              message: app.getName(),
              detail: `버전 ${app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}\n\n모든 산식은 로컬에서 결정적으로 평가됩니다.`,
            });
          },
        },
        {
          label: "업데이트 확인",
          click: () => {
            autoUpdater.checkForUpdatesAndNotify().catch(() => {
              dialog.showMessageBox({ type: "info", message: "업데이트 채널이 설정되지 않았습니다." });
            });
          },
        },
        { role: "toggleDevTools" as const, label: "개발자 도구 (고급)" },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
