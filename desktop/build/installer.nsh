; NSIS customization for 뜌땨 생활행정 (Tyutya) desktop installer.
;
; - Per-user install — never elevate.
; - Custom Korean strings.
; - Quiet uninstall of orphan shortcuts.

!macro customHeader
  ; Per-user install path.
  RequestExecutionLevel user
!macroend

!macro preInit
  ; Default install dir 명시 (NSIS oneClick=false 일 때만 의미).
  SetRegView 64
  WriteRegExpandStr HKCU "Software\Tyutya" "InstallLocation" "$LOCALAPPDATA\Tyutya"
  WriteRegExpandStr HKCU "Software\Tyutya" "Version" "${VERSION}"
!macroend

!macro customInstall
  DetailPrint "사용자 폴더에 설치 중…"
!macroend

!macro customUnInstall
  ; 사용자 데이터(설정·로그) 는 보존 — 사용자가 명시 삭제하지 않는 한 남긴다.
  DeleteRegKey HKCU "Software\Tyutya"
!macroend
