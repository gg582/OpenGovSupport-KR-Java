# 환경변수 문서

이 프로젝트에서 사용하는 환경변수 목록입니다.

## 프론트엔드

| 변수명 | 기본값 | 설명 |
|--------|--------|------|
| `NEXT_PUBLIC_API_BASE_URL` | `https://tyutya.top` | API 기본 URL. 스크립트 납품(export) 시 생성되는 셸 스크립트에서 사용되는 백엔드 주소입니다. 사용자가 별도의 서버를 운영할 경우 이 값을 변경할 수 있습니다. |

### 사용 예시

```bash
# 개발 시 로컬 백엔드 사용
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080 npm run dev

# 빌드 시 커스텀 URL 주입
NEXT_PUBLIC_API_BASE_URL=https://api.example.com npm run build
```

### 스크립트 납품에서의 활용

전문가 모드의 **스크립트 납품** 기능(Bash / Zsh / PowerShell)은 `NEXT_PUBLIC_API_BASE_URL`을 기본값으로 사용합니다. 생성된 스크립트는 실행 환경의 `API_BASE_URL` 환경변수를 우선적으로 인식하며, 설정되지 않은 경우 `NEXT_PUBLIC_API_BASE_URL`의 기본값으로 폰백됩니다.

```bash
# Bash/Zsh 스크립트 내
BASE_URL="${API_BASE_URL:-https://tyutya.top}"
```

```powershell
# PowerShell 스크립트 내
$BASE_URL = if ($env:API_BASE_URL) { $env:API_BASE_URL } else { "https://tyutya.top" }
```

## 백엔드

현재 백엔드는 별도의 환경변수 문서를 참조하세요.
