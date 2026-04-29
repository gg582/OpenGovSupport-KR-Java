# 사회복지 계산식 — 웹앱

사회복지 업무에서 자주 쓰이는 계산 16종(사적이전소득·이자소득 공제·재산상담·
상속분·긴급공제·해외체류 등)을 **Go(net/http) + Next.js** 로 구현한 웹 앱입니다.
중위소득·차감율·기준금액 등은 모두 법령에 근거한 공개정보이므로
`src/backend/domain/standards.go` 에 직접 박아두고, 폼 기본값으로도 노출합니다.

## 구조

```
/Makefile                  ← `make run` 한 줄로 프런트+백엔드 동시 기동
/src/
  /backend/                ← Go (stdlib only, net/http)
    main.go
    domain/
      features.go          ← Feature 매니페스트 (UI 폼 자동 생성용)
      standards.go         ← 법령 기반 공개 기준값 (중위소득·차감율 등)
      util.go
    handlers/              ← 도메인별 HTTP 핸들러
  /frontend/               ← Next.js (App Router)
    app/
      page.tsx             ← 모든 기능을 한 화면에서 보여주는 홈
      features/[...id]/    ← 동적 기능 페이지 (Feature 매니페스트로 폼 자동 생성)
      components/, lib/
```

## 실행

### 로컬 (Go + Node 직접)

```bash
make run
```

- 백엔드 :8080 (`go run ./...`)
- 프런트엔드 :3000 (`npm run dev`, `/api/*` → 백엔드로 rewrite)
- 첫 실행 시 `npm install` 과 `go mod download` 가 자동으로 실행됩니다.

원하면 따로 띄울 수도 있습니다:

```bash
make run-backend     # 백엔드만
make run-frontend    # 프런트엔드만
make loadtest        # 200 동시 / 10초 RPS 측정
make bench           # numerics 패키지 마이크로벤치
```

### Docker Compose

```bash
cp .env.example .env       # (선택) 포트·튜닝 파라미터 변경 시
make compose-up            # docker compose up -d --build
make compose-logs          # 로그 따라가기
make compose-down
```

- 기본 노출 포트: 프런트엔드 31778 / 백엔드 31777 (`docker-compose.yml` 의
  `${FRONTEND_PORT:-31778}` / `${BACKEND_PORT:-31777}` 참조).
- 백엔드 이미지: `golang:1.23-alpine` 빌드 → `distroless/static:nonroot` 런타임 (≈ 10 MB)
- 프런트엔드 이미지: Next.js standalone 출력으로 `node:20-alpine` 위에 올림 (≈ 150 MB, `node_modules` 미포함)
- 두 컨테이너는 `app` 브리지 네트워크에 합류, 프런트엔드는 `BACKEND_URL=http://backend:8080` 으로 백엔드를 호출
- `.env` 의 변수로 `POOL_WORKERS / POOL_QUEUE / GOGC_TARGET / JSON_INDENT / *_CPUS / *_MEMORY` 모두 외부에서 조정 가능

## 디자인 원칙

- **모든 기능이 홈 화면에서 즉시 보임.** `domain.AllFeatures()` 가 단일 진실의 원천이고,
  백엔드/프런트엔드가 동일한 매니페스트를 공유합니다. 새 기능 추가 = 매니페스트 한 줄 + 핸들러 함수 하나.
- **법령 기반 공개정보를 코드에 직접 보유.** 중위소득·기초연금·차감율·법정 상속분 등은
  `domain/standards.go` 에 연도·항목별로 박혀 있어 외부에서 바로 사용 가능합니다.
  새 연도의 고시값이 나오면 이 파일만 갱신합니다.
- **클립보드 = 응답 텍스트.** 핸들러는 응답 JSON 의 `text` 필드에 결과를 담고, 프런트의
  "복사" 버튼이 `navigator.clipboard.writeText` 를 사용합니다.
- **PDF = 인쇄 미리보기.** 인쇄용 HTML 을 응답에 실어 보내고, 사용자가 브라우저의
  "PDF로 저장" 으로 직접 저장합니다.

## 엔드포인트

| 도메인 | 기능 | 엔드포인트 |
|---|---|---|
| 사적이전소득 | 계산        | `POST /api/private-income/calc` |
| 사적이전소득 | 상담기록    | `POST /api/private-income/record` |
| 사적이전소득 | 출력본(PDF) | `POST /api/private-income/pdf` |
| 이자소득     | 계산        | `POST /api/interest-income/calc` |
| 이자소득     | 상담기록    | `POST /api/interest-income/record` |
| 이자소득     | 출력본(PDF) | `POST /api/interest-income/pdf` |
| 재산상담     | 상담생성    | `POST /api/property/consult` |
| 상속분상담   | 상담생성    | `POST /api/inheritance/consult` |
| 긴급공제설명 | 설명 생성   | `POST /api/emergency/explain` |
| 해외체류     | 신규        | `POST /api/overseas/new` |
| 해외체류     | 기존        | `POST /api/overseas/existing` |
| 해외체류     | 기초/장애인 연금 | `POST /api/overseas/pension` |
| 해외체류     | 차상위 본인부담경감 | `POST /api/overseas/care` |
| 공용         | 개월수계산  | `POST /api/shared/months` |
| 공용         | 초기차감금액 | `POST /api/shared/initial-deduction` |
| 이벤트       | 재산변동 시트 | `POST /api/events/property-sheet` |

## 런타임 계층 (`src/backend/runtime/`)

부하 처리 / 가용성 / 지연 최소화를 위해 핸들러 위에 다음 4단 미들웨어를 둡니다.
모든 모듈은 stdlib 만 사용합니다.

| 모듈 | 역할 |
|---|---|
| `runtime/pool.go`  | 바운디드 워커 풀 + 2단 우선순위 큐 (fast / slow). `Content-Length` 가 `POOL_FAST_THRESHOLD` (기본 4 KiB) 미만이면 fast 레인. 워커 수는 `POOL_WORKERS` (기본 = `NumCPU`). 큐가 다 차면 503 + `Retry-After` 로 백프레셔. |
| `runtime/batch.go` | 단일플라이트 코얼레서. method+path+body 해시가 같은 동시 요청은 한 번만 실제로 계산하고 결과를 모든 호출자에게 fan-out. 같은 단순 요청이 폭주해도 핸들러 호출이 압축됩니다. |
| `runtime/numerics/` | SIMD-ready 추상화. 공개 API(`Sum`/`Dot`/`Scale`/`MaxFloat` 등) 만 노출하고, 내부 구현은 build tag 로 portable Go ↔ asm SIMD 사이를 전환합니다. 호출자는 어떤 구현이 활성인지 알 수 없습니다. 자세한 사용/확장 가이드는 `runtime/numerics/doc.go`. |
| `/api/runtime/stats` | 풀/코얼레서 상태 노출(워커 수, 큐 깊이, 누적 처리/거절 수, 평균 지연, 코얼레스 히트율). |

**미들웨어 체인 순서** (`main.go`):

```
CORS → 로깅 → Pool → Coalescer → mux → 도메인 핸들러
```

벤치 (실측): 동일 본문으로 50개 동시 POST 시 코얼레서가 ~50% 를 즉시 fan-out 으로
처리하고 평균 지연 ~140 µs 유지. `runtime/numerics.Sum` 1024 요소 SIMD-친화 unrolled
루프 ~247 ns/op (제로 할당). `make bench` 로 직접 측정 가능합니다.

**환경 변수**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `POOL_WORKERS` | `runtime.NumCPU()` | 워커 고루틴 수 |
| `POOL_QUEUE` | 1024 | 레인 당 큐 용량 |
| `POOL_FAST_THRESHOLD` | 4096 | fast 레인 진입 바이트 임계값 |

## 의존성

- Go ≥ 1.22 (ServeMux pattern matching, atomic.Int64)
- Node ≥ 18, npm

서드파티 라이브러리는 사용하지 않습니다 (Next.js 와 React 만 npm 의존).
