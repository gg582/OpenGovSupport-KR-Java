/**
 * Linux 언인스톨러 — 가벼운 bash 스크립트 + zenity/kdialog/xmessage 다이얼로그.
 *
 * Electron 셸 자체로 삭제 다이얼로그를 띄우면 무겁기도 하고, 자기 자신을 안전하게
 * 지우기가 까다롭다. 그래서 install 시점에 사용자 영역에 작은 bash 스크립트를
 * 떨어뜨리고, 메뉴에서 그 스크립트가 직접 실행되도록 한다.
 *
 * 동작 순서:
 *   1) "앱을 삭제합니다." + 확인/취소 다이얼로그
 *   2) 확인 시 .desktop 항목·아이콘·사용자 데이터 제거
 *   3) 마지막으로 install root + 본 스크립트 자체까지 trampoline 으로 지움
 */

import * as fs from "fs";
import * as path from "path";

export interface UninstallTargets {
  /** ~/.local/share/tyutya — 앱 사본·언인스톨러 자체 위치 */
  installRoot: string;
  /** ~/.local/share/applications/tyutya.desktop */
  appDesktopFile: string;
  /** ~/.local/share/applications/tyutya-uninstall.desktop */
  uninstallDesktopFile: string;
  /** hicolor 아이콘 */
  iconFile: string;
  /** Electron userData (~/.config/뜌땨 생활행정) — 사용자 데이터 */
  userDataDir: string;
  /** 바탕화면 바로가기 (없을 수 있음) */
  desktopShortcut: string;
  /** 본 언인스톨러 스크립트의 최종 위치 */
  selfPath: string;
}

const PRODUCT_NAME = "뜌땨 생활행정";

/** bash 더블쿼트 안전한 문자열 — `"`, `$`, `\`, 백틱을 이스케이프. */
function shq(s: string): string {
  return s.replace(/(["\\$`])/g, "\\$1");
}

/**
 * 언인스톨러 본체 스크립트 생성. 모든 경로는 절대경로로 박아 넣는다 (XDG 변수에 의존하지 않음).
 *
 * 자기 자신을 어떻게 지우는가:
 *   본 스크립트가 마지막 단계에서 trampoline 임시 스크립트(/tmp/tyutya-finalize-*.sh) 를 만들고,
 *   nohup 로 그 스크립트를 백그라운드 실행한 뒤 즉시 종료한다. trampoline 은 0.5 초 후 install root 와
 *   본 스크립트, 그리고 자기 자신을 삭제한다 — 이렇게 하면 실행 중인 파일을 자기가 지우지 않으므로 안전.
 */
export function renderUninstallerScript(t: UninstallTargets): string {
  return `#!/usr/bin/env bash
# ${PRODUCT_NAME} 언인스톨러 — install 시 자동 생성. 직접 편집 금지.
set -u
export LC_ALL="\${LC_ALL:-ko_KR.UTF-8}"

PRODUCT="${shq(PRODUCT_NAME)}"
MSG="앱을 삭제합니다."

INSTALL_ROOT="${shq(t.installRoot)}"
APP_DESKTOP="${shq(t.appDesktopFile)}"
UNINSTALL_DESKTOP="${shq(t.uninstallDesktopFile)}"
ICON_FILE="${shq(t.iconFile)}"
USER_DATA="${shq(t.userDataDir)}"
DESKTOP_SHORTCUT="${shq(t.desktopShortcut)}"
SELF="${shq(t.selfPath)}"

confirm() {
  if command -v zenity >/dev/null 2>&1; then
    zenity --question --title="$PRODUCT" --text="$MSG" \\
      --ok-label="확인" --cancel-label="취소" --width=340 --no-wrap 2>/dev/null
    return $?
  fi
  if command -v kdialog >/dev/null 2>&1; then
    kdialog --title "$PRODUCT" --yesno "$MSG" --yes-label "확인" --no-label "취소" 2>/dev/null
    return $?
  fi
  if command -v xmessage >/dev/null 2>&1; then
    # xmessage 는 button1 이 0, button2 가 101 종료코드
    xmessage -center -title "$PRODUCT" -buttons "확인:0,취소:1" "$MSG" 2>/dev/null
    return $?
  fi
  # GUI 가 없으면 TTY 폴백.
  printf '%s\\n' "$MSG"
  read -rp "확인하려면 y, 취소하려면 n: " ans
  case "$ans" in y|Y) return 0 ;; *) return 1 ;; esac
}

notify() {
  local m="$1"
  if command -v zenity >/dev/null 2>&1; then
    zenity --info --title="$PRODUCT" --text="$m" --width=320 --no-wrap 2>/dev/null || true
  elif command -v kdialog >/dev/null 2>&1; then
    kdialog --title "$PRODUCT" --msgbox "$m" 2>/dev/null || true
  fi
}

if ! confirm; then
  exit 0
fi

# 실행 중일 수 있는 앱 종료 — 같은 파일을 잡고 있으면 삭제 실패하므로.
pkill -f "$INSTALL_ROOT" 2>/dev/null || true
sleep 0.4

# 메뉴/아이콘/단축키 정리.
rm -f -- "$APP_DESKTOP" "$UNINSTALL_DESKTOP" "$ICON_FILE" "$DESKTOP_SHORTCUT" 2>/dev/null

# 사용자 데이터 (설정·로그·DB) 일괄 제거.
if [ -n "$USER_DATA" ] && [ -d "$USER_DATA" ]; then
  rm -rf -- "$USER_DATA"
fi

# 데스크톱 데이터베이스/아이콘 캐시 새로고침 — 메뉴에서 즉시 사라지도록.
command -v update-desktop-database >/dev/null 2>&1 && \\
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && \\
  gtk-update-icon-cache -q -t -f "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true

# trampoline — 본 스크립트와 install root 를 백그라운드에서 비동기 삭제.
TRAMP="$(mktemp /tmp/tyutya-finalize-XXXXXX.sh)"
cat > "$TRAMP" <<TRAMP_EOF
#!/usr/bin/env bash
sleep 0.6
rm -rf -- "$INSTALL_ROOT"
rm -f  -- "$SELF"
rm -f  -- "\\$0"
TRAMP_EOF
chmod +x "$TRAMP"

notify "삭제가 완료되었습니다."

# detached — 부모(이 스크립트) 가 종료된 뒤 trampoline 이 본 스크립트를 안전하게 지운다.
nohup "$TRAMP" >/dev/null 2>&1 < /dev/null &
disown 2>/dev/null || true
exit 0
`;
}

/**
 * 언인스톨러 .desktop 엔트리 — 응용프로그램 메뉴에 표시되는 항목.
 *
 * NoDisplay=false 로 메뉴에 노출, NotShowIn 으로 트레이엔 안 뜨게 함.
 * Exec 는 bash 로 명시 호출 — chmod +x 가 풀려도 동작하도록.
 */
export function renderUninstallerDesktopEntry(t: UninstallTargets, version: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${PRODUCT_NAME} 제거`,
    "GenericName=Uninstaller",
    `Comment=${PRODUCT_NAME} 을(를) 컴퓨터에서 제거합니다.`,
    `Exec=/usr/bin/env bash "${t.selfPath}"`,
    "Icon=tyutya",
    "Categories=Settings;",
    "Terminal=false",
    `X-AppImage-Version=${version}`,
    "",
  ].join("\n");
}

/**
 * 언인스톨러 스크립트와 .desktop 엔트리를 디스크에 작성.
 * 호출 측은 fs.mkdirSync 로 부모 폴더가 존재함을 보장한 뒤 호출할 것.
 */
export function writeUninstaller(
  t: UninstallTargets,
  version: string,
): void {
  fs.mkdirSync(path.dirname(t.selfPath), { recursive: true });
  fs.writeFileSync(t.selfPath, renderUninstallerScript(t), { encoding: "utf8", mode: 0o755 });
  fs.chmodSync(t.selfPath, 0o755);

  fs.mkdirSync(path.dirname(t.uninstallDesktopFile), { recursive: true });
  fs.writeFileSync(
    t.uninstallDesktopFile,
    renderUninstallerDesktopEntry(t, version),
    { encoding: "utf8", mode: 0o644 },
  );
}
