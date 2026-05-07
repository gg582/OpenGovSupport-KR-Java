# Desktop icon assets

이 디렉터리는 electron-builder 가 참조할 아이콘 파일을 보관합니다.

| 플랫폼 | 파일 | 권장 크기 |
|---|---|---|
| Windows | `icon.ico` | 256×256 + 64 + 32 + 16 multi-res |
| macOS | `icon.icns` | 1024×1024 base, Apple `iconutil` 변환 |
| Linux / FreeBSD | `icon.png` | 512×512 PNG |

본 저장소에는 실제 아이콘 바이너리가 포함되어 있지 않습니다 — 디자인 가이드라인이
확정된 뒤 동일 이름으로 추가하면 자동으로 빌드에 반영됩니다.

임시 빌드를 돌리려면 OS 기본 데몬 아이콘이라도 PNG 1장을 `icon.png` 로 두면 됩니다.
electron-builder 는 PNG 만 있어도 NSIS 빌드를 진행합니다 (자동 다운스케일).
