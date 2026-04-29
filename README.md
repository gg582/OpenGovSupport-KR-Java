# 사회복지 계산식 — 웹앱

사회복지 업무에서 자주 쓰이는 계산 16종(사적이전소득·이자소득 공제·재산상담·
상속분·긴급공제·해외체류 등)을 **Spring Boot 4.0.2 (Java 21) + Next.js** 로 구현한 웹 앱입니다.
중위소득·차감율·기준금액 등은 모두 법령에 근거한 공개정보이므로
`src/backend/src/main/java/com/opengov/support/domain/Standards.java` 에 직접 박아두고, 폼 기본값으로도 노출합니다.

## 구조

```
/Makefile                  ← `make run` 한 줄로 프런트+백엔드 동시 기동
/src/
  /backend/                ← Spring Boot 4.0.2 (Java 21, virtual threads)
    pom.xml
    Dockerfile
    src/main/java/com/opengov/support/
      OpenGovSupportApplication.java
      config/                ← CORS / RuntimeProperties
      domain/                ← Standards, Features, DomainUtil (법령 기반 표 포함)
      runtime/               ← Pool / Coalescer / Numerics / Stats / Logging filter
      web/                   ← Result, JsonBody, GlobalErrorHandler, PrintableHtml
      web/controller/        ← 도메인별 @RestController
    src/main/resources/
      application.yml
  /frontend/               ← Next.js (App Router)
    app/
      page.tsx             ← 모든 기능을 한 화면에서 보여주는 홈
      features/[...id]/    ← 동적 기능 페이지 (Feature 매니페스트로 폼 자동 생성)
      components/, lib/
```

## 실행

### 로컬 (Java + Node 직접)

```bash
make run
```

- 백엔드 :8080 (`mvn spring-boot:run`)
- 프런트엔드 :3000 (`npm run dev`, `/api/*` → 백엔드로 rewrite)
- 첫 실행 시 `npm install` 과 `mvn dependency:go-offline` 이 자동으로 실행됩니다.

원하면 따로 띄울 수도 있습니다:

```bash
make run-backend     # 백엔드만
make run-frontend    # 프런트엔드만
make build           # 백엔드 fat jar 빌드 (target/backend.jar)
make test            # 백엔드 테스트
make loadtest        # `hey` 가 설치되어 있으면 200 동시 / 2,000 요청 부하 테스트
```

### Docker Compose

```bash
cp .env.example .env       # (선택) 포트·튜닝 파라미터 변경 시
make compose-up            # docker compose up -d --build
make compose-logs          # 로그 따라가기
make compose-down
```

- HTTPS는 Spring Boot 내장 SSL(Tomcat)이 처리합니다. nginx 없이 포트 443에서 직접 TLS 종료.
- HTTP(80) 요청은 Spring Boot가 자동으로 HTTPS(443)로 301 리다이렉트합니다.
- 포트 8080(HTTP)은 컨테이너 내부 전용 — Next.js 프런트엔드가 `BACKEND_URL=http://backend:8080` 으로 API를 호출하는 데 사용.
- 인증서 파일(`cert.pem`, `privkey.pem`)을 `CERTS_DIR`(기본 `./certs`)에 놓으면 컨테이너에 마운트됩니다.
- 프런트엔드(Next.js, 포트 3000)는 내부 네트워크에만 노출되고, Spring Boot가 역방향 프록시 역할을 합니다.
- 두 컨테이너는 `app` 브리지 네트워크에 합류, 프런트엔드는 `BACKEND_URL=http://backend:8080` 으로 백엔드를 호출
- `.env` 의 변수로 `POOL_WORKERS / POOL_QUEUE / POOL_FAST_THRESHOLD / JSON_INDENT / JAVA_OPTS / *_CPUS / *_MEMORY` 모두 외부에서 조정 가능

## 디자인 원칙

- **모든 기능이 홈 화면에서 즉시 보임.** `Features.all()` 이 단일 진실의 원천이고,
  백엔드/프런트엔드가 동일한 매니페스트를 공유합니다. 새 기능 추가 = 매니페스트 한 항목 + 컨트롤러 메서드 하나.
- **법령 기반 공개정보를 코드에 직접 보유.** 중위소득·기초연금·차감율·법정 상속분 등은
  `Standards.java` 에 연도·항목별로 박혀 있어 외부에서 바로 사용 가능합니다.
  새 연도의 고시값이 나오면 이 파일만 갱신합니다.
- **클립보드 = 응답 텍스트.** 컨트롤러는 응답 JSON 의 `text` 필드에 결과를 담고, 프런트의
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

## 런타임 계층 (`com.opengov.support.runtime`)

부하 처리 / 가용성 / 지연 최소화를 위해 핸들러 위에 다음 Servlet 필터들을 둡니다.
서드파티 비즈니스 라이브러리 없이 Spring Boot 만 사용합니다.

| 모듈 | 역할 |
|---|---|
| `BoundedRequestPool` | 바운디드 워커 풀(가상 스레드) + 2단 우선순위 큐(fast / slow). `Content-Length` 가 `POOL_FAST_THRESHOLD` (기본 4 KiB) 미만이면 fast 레인. 워커 수는 `POOL_WORKERS` (0 = `availableProcessors()`). 큐가 다 차면 503 + `Retry-After` 로 백프레셔. |
| `RequestCoalescer` | 단일플라이트 코얼레서. method+path+body 해시가 같은 동시 요청은 한 번만 실제로 계산하고 결과를 모든 호출자에게 fan-out. 같은 단순 요청이 폭주해도 핸들러 호출이 압축됩니다. |
| `Numerics` | JIT 친화적인 수동 unrolled 루프(`sum` / `dot` / `scale` / `maxFloat` 등). JVM C2 가 SIMD 로 자동 변환합니다. |
| `RuntimeStatsController` | 풀/코얼레서 상태 노출(`/api/runtime/stats`): 워커 수, 큐 깊이, 누적 처리/거절 수, 평균 지연, 코얼레스 히트율. |

**필터 체인 순서** (`@FilterRegistrationBean` 으로 등록):

```
CORS (Spring MVC) → RequestLoggingFilter → BoundedRequestPool → RequestCoalescer → DispatcherServlet → 컨트롤러
```

**환경 변수**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 443 | HTTPS 포트 |
| `HTTP_PORT` | 80 | HTTP 포트 (HTTPS 리다이렉트용) |
| `INTERNAL_PORT` | 8080 | 내부 HTTP 포트 (프런트엔드 → 백엔드 API 호출용) |
| `SSL_ENABLED` | `false` (로컬), `true` (Docker) | TLS 활성화 여부 |
| `SSL_CERT` | `/certs/cert.pem` | TLS 인증서 경로 (PEM) |
| `SSL_KEY` | `/certs/privkey.pem` | TLS 개인키 경로 (PEM) |
| `FRONTEND_URL` | `http://frontend:3000` | 프록시 대상 프런트엔드 URL |
| `POOL_WORKERS` | `0` (= `Runtime.availableProcessors()`) | 워커 가상 스레드 수 |
| `POOL_QUEUE` | 1024 | 레인 당 큐 용량 |
| `POOL_FAST_THRESHOLD` | 4096 | fast 레인 진입 바이트 임계값 |
| `JSON_INDENT` | `false` | dev 에서 들여쓰기된 JSON 을 보고 싶다면 `true` |
| `JAVA_OPTS` | _(없음)_ | Docker 이미지에서 JVM 인자 추가 (`-XX:+UseG1GC` 등) |

## 의존성

- Java ≥ 21
- Maven ≥ 3.9
- Spring Boot 4.0.2 (Spring Framework 7, Jakarta EE 11)
- Node ≥ 18, npm

서드파티 비즈니스 라이브러리는 사용하지 않습니다 — Spring Boot `spring-boot-starter-web` 만 사용하며,
도메인 계산 로직은 표준 라이브러리(`java.time`, `java.util`)로만 작성되어 있습니다.
