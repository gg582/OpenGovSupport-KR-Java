# 정부지원·세무 계산

「국민기초생활보장법」·「기초연금법」 등 사회복지 행정과
「소득세법」·「법인세법」·「상속세 및 증여세법」·「부가가치세법」·「조세특례제한법」 등
세무 법령의 공개 산식을 코드로 평가하는 웹앱.
**Spring Boot 4.0.2 (Java 21, virtual threads) + Next.js 14** 구성.

내부 산술은 모두 `BigDecimal` 임의정밀 — 부동소수점 오차 없음.

## 면책 고지

본 사이트는 세무사·세무대리 행위를 수행하지 않으며, 산출 결과의 정확성·완전성·최신성을
보증하지 않습니다. 산식 자체는 공개 법령에 근거하나, 케이스별 적용 여부와 예외 처리는
사용자가 직접 확인해야 합니다. 산출 결과는 신고·납부·수급의 효력을 갖지 않으므로 실제
신고는 반드시 홈택스(국세청) / 복지로(보건복지부) / 정부24 / 세무전문가를 통해 확정해야
합니다.

## 정보 구조

```
헤더 메뉴
├── 사회복지   ← 16종 (사적이전소득 · 이자소득 · 재산상담 · 상속분 · 긴급공제 · 해외체류 · 공용)
└── 개인세무   ← 16종 (아래 표 참조)
```

`Feature.section` 필드(`welfare`/`tax`)로 자동 분류되며 LNB가 섹션별로 필터.
새 기능 추가 = `Features.all()` 또는 `TaxFeatures.all()` 매니페스트에 항목 추가.

## 개인세무 — 16종 + 4개 정규형

세무 룰은 모두 정규화된 4가지 산식 형태 중 하나로 표현되며,
`resources/tax-rules/{year}/{ruleId}.json`에 1:1로 저장된다.

| 도메인 | 기능 | 룰 ID | 산식 유형 |
|---|---|---|---|
| 11 종합소득세 | 산출세액 (8단계 누진) | `comprehensive-income-tax` | A |
| 11 종합소득세 | 환급/추징 시뮬레이터 | `comprehensive-income-refund` | 합성 |
| 12 근로소득 | 근로소득공제 (5단계, qd<0) | `earned-income-deduction` | A |
| 12 근로소득 | 연말정산 통합 시뮬레이터 | `year-end-settlement` | 합성 |
| 13 특별세액공제 | 의료비 (총급여 3% 초과의 15%) | `medical-expense-credit` | C |
| 13 특별세액공제 | 교육비 (단계별 cap × 15%) | `education-credit` | B + capMap |
| 13 특별세액공제 | 월세 (총급여 5,500만 ↓ 17% / ↑ 15%) | `rent-credit` | B + rateBands |
| 13 특별세액공제 | 연금계좌 (5,500만 ↓ 15% / ↑ 12%) | `pension-credit` | B + rateBands |
| 13 특별세액공제 | 기부금 (1천만 ↓ 15% / ↑ 30%) | `donation-credit` | A (2-bracket) |
| 14 기타세액공제 | 자녀 (1~2번 25만 + 3번~ 40만) | `child-credit` | D (b<0) |
| 15 사업소득 | 단순경비율 추정 필요경비 | `simple-expense-rate` | B + rateMap |
| 16 근로장려금 | 단독가구 phase-in/plateau/phase-out | `earned-income-credit` | D |
| 17 법인세 | 산출세액 (4단계 누진) | `corporate-tax` | A |
| 18 상속세 | 산출세액 (5단계 누진) | `inheritance-tax` | A |
| 19 증여세 | 산출세액 (5단계 누진) | `gift-tax` | A |
| 20 부가가치세 | 납부세액 = (매출-매입)×10% | `vat-payable` | C |

**정규형 정의**:
| 유형 | 식 | 예 |
|---|---|---|
| A 누진세 | `tax = x*r − c` | 종합소득세, 법인세, 상속세, 증여세, 근로소득공제, 기부금 |
| B 한도성 비율 | `credit = min(x, cap) × r` | 월세, 연금, 교육비, 단순경비율 |
| C 임계공제 | `credit = max(x − base*tr, 0) × r` | 의료비, 부가가치세 |
| D 구간 인센티브 | phase-in / plateau / phase-out | 근로장려금, 자녀 세액공제 |

Type B 확장 옵션:
- `rateBands` — 변수 조건부 rate 분기 (예: 총급여에 따른 17%/15%)
- `rateMap` — 텍스트 키로 rate 룩업 (예: 업종별 단순경비율)
- `capVariable` / `capMap` — cap을 ctx 변수 또는 텍스트 매핑에서 조회

## 백엔드 아키텍처

```
src/backend/src/main/java/com/opengov/support/
├── OpenGovSupportApplication.java
├── config/                   ← CORS / TLS / RuntimeProperties
├── domain/                   ← Standards (복지 기준값) · Feature · Features
├── runtime/                  ← BoundedRequestPool · RequestCoalescer · Numerics · Stats
├── tax/
│   ├── TaxStandards.java         ← 세무 기준값 (세율표·한도·표준세액공제 등)
│   ├── TaxFeatures.java          ← 개인세무 매니페스트
│   ├── TaxCalculation.java       ← 6단 파이프라인 오케스트레이터
│   ├── rule/                     ← TaxRule · EligibilityClause · DocumentSpec · RuleRegistry
│   ├── formula/                  ← FormulaType · FormulaContext · FormulaEngine · FormulaResult
│   ├── eligibility/              ← EligibilityEngine · EligibilityResult
│   ├── document/                 ← DocumentEngine · DocumentChecklist
│   ├── explain/                  ← Explainer · ExplanationStep
│   ├── audit/                    ← TaxAudit (감사로그+통계) · TaxInputValidator (음수/비현실 거부)
│   └── composite/                ← YearEndSettlement · ComprehensiveRefund (합성 시나리오)
└── web/
    ├── Result · ApiException · JsonBody · GlobalErrorHandler · PrintableHtml
    └── controller/
        ├── SystemController            (GET /api/features · /api/health)
        ├── TaxController               (POST /api/tax/{ruleId} · 합성 2종 · GET /api/tax/rules)
        ├── PrivateIncomeController · InterestIncomeController · PropertyController
        ├── InheritanceController · OverseasController · EmergencyController · SharedController
        ├── EventsController · FrontendProxyController
        └── ...
```

### 세무 계산 파이프라인 (6단)

```
사용자 입력
  → TaxInputValidator        (음수·1조원 초과·NaN 거부, 거부 시 audit.recordRejection)
  → FormulaContext.of(...)   (BigDecimal/text 두 종류 변수 바인딩)
  → RuleRegistry.get(year, ruleId)  (없으면 직전 연도로 fallback)
  → EligibilityEngine.check  (8개 연산자: lt/lte/gt/gte/eq/ne/present/absent)
  → FormulaEngine.evaluate   (Type A/B/C/D 분기, 자격 통과 시에만)
  → DocumentEngine.build     (필요서류 + 발급기관 + 제출채널)
  → Explainer.render         ([면책][근거 법령][자격][산식][대입][결과][필요서류][제출채널])
  → TaxAudit.recordCall      (룰별 호출수 + qualified/blocked 카운터 + SLF4J INFO)
```

`TaxAudit` 의 로그 라인:
```
tax-audit ts=2026-05-07T03:35:00Z ruleId=corporate-tax year=2026 qualified=true amount=1880000000 durationMs=2
```

입력 원문은 로그에 남기지 않는다 (PII 보호).

## 데이터·캐싱·DB

- **DB 없음**. 모든 기준값은 `domain/Standards.java` (복지) + `tax/TaxStandards.java` (세무)에 연도별 하드코딩.
  세무 룰은 `resources/tax-rules/{year}/*.json` 으로도 분리 (RuleRegistry가 시작 시 로드).
- **캐싱 1단** — `RequestCoalescer`: method+path+body 해시가 같은 동시 요청을 단일플라이트로 압축.
- **캐싱 2단** — `RuleRegistry`: 시작 시 1회 로드 후 read-only `ConcurrentHashMap`. 런타임 변경 없음.
- **백프레셔** — `BoundedRequestPool`: 가상 스레드 + 2단 우선순위 큐 (fast/slow). 큐 만석 시 503 + Retry-After.

## 법령 갱신 파이프라인

새 연도 (예: 2027) 고시값이 나올 때:

1. **세무 룰 갱신**:
   ```
   cp -r src/backend/src/main/resources/tax-rules/2026 \
         src/backend/src/main/resources/tax-rules/2027
   ```
   `2027/` 안의 변경된 룰만 수정. 변경 없는 룰 파일은 그대로 두거나 삭제 — `RuleRegistry`가 직전 연도로 자동 fallback.

2. **세무 기준값 갱신** — `tax/TaxStandards.java` 의 `SUPPORTED_YEARS` 리스트 맨 앞에 새 연도 추가 + 관련 상수(세율·한도·표준세액공제) 갱신.

3. **복지 기준값 갱신** — `domain/Standards.java` 의 `SUPPORTED_YEARS` + 중위소득·기초연금·차감율·주거급여 표 갱신.

4. **검증**:
   ```
   GET /api/tax/rules                      → coverage 연도별 룰 개수
   GET /api/tax/rules/{year}               → 해당 연도 전체 룰 노출
   GET /api/runtime/stats                  → tax.audit + tax.rules
   ```

5. **변경 이력** — git commit 메시지에 「소득세법」§N 개정 일자·고시번호 명시 권장.

## 사기·이상값 방지

`TaxInputValidator` 가 룰엔진 진입 전 1차 방어:
- 음수 금액 거부 (`year` 등 메타값 제외)
- 단일 변수 1조원 초과 거부 (오타·DoS 방지)
- `year` 1900~2100 범위
- NaN / Infinity 거부

거부 시 `TaxAudit.recordRejection` 으로 SIEM 친화 로그 기록.

## API 엔드포인트 (개인세무)

| Method | Path | 용도 |
|---|---|---|
| POST | `/api/tax/{ruleId}` | 단일 룰 평가 (16종 룰 모두) |
| POST | `/api/tax/year-end-settlement` | 연말정산 통합 합성 |
| POST | `/api/tax/comprehensive-income-refund` | 종합소득세 환급/추징 합성 |
| GET  | `/api/tax/rules` | 보유 연도별 룰 개수 |
| GET  | `/api/tax/rules/{year}` | 특정 연도 전체 룰 (감사용) |
| GET  | `/api/features` | 사회복지 + 개인세무 매니페스트 (UI 자동생성) |
| GET  | `/api/runtime/stats` | 풀·코얼레서·세무 감사 통계 |

요청 본문은 `{year?, ...룰별 변수}` JSON. `year` 생략 시 최신연도(`TaxStandards.currentYear()`).

응답은 표준 `Result`:
```
{
  "title": "…",
  "text":  "[면책]…[근거 법령]…[항목]…[자격]…[산식]…[대입]…[결과]…[필요서류]…[제출채널]…",
  "data":  { "ruleId":…, "year":…, "amount":…, "eligibility":…, "documents":…, "intermediate":… }
}
```

## 프런트엔드

Next.js 14 App Router. 라우트:
- `/` — 두 섹션 카드 + 면책 고지
- `/welfare` — 사회복지 16종 그룹 표
- `/tax` — 개인세무 16종 그룹 표
- `/features/[...id]` — Feature 매니페스트로 폼·결과 자동 생성 (`FeatureForm.tsx`)
- `/runtime` — 백엔드 통계 (풀/코얼레서/세무 감사)

LNB 는 현재 URL의 섹션을 감지해 해당 섹션 features만 그룹별로 노출.
헤더에 "사회복지 / 개인세무" 탭이 있고 푸터에 면책 두 단락이 항상 표시.

## 실행

### 로컬

```bash
make run            # backend :8080 + frontend :3000 동시
make run-backend    # backend only
make run-frontend   # frontend only
make build          # backend fat jar (target/backend.jar)
make test
```

### Docker Compose

```bash
cp .env.example .env
make compose-up
make compose-logs
make compose-down
```

- HTTPS는 Spring Boot 내장 SSL이 처리 (포트 443).
- HTTP(80) → HTTPS(443) 자동 리다이렉트.
- 인증서를 `${CERTS_DIR}` (기본 `./certs`)에 `cert.pem`, `privkey.pem` 두 파일로 배치.

## 환경 변수 (주요)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` / `HTTP_PORT` / `INTERNAL_PORT` | 443 / 80 / 8080 | TLS / HTTP 리다이렉트 / 내부 |
| `SSL_ENABLED` | false (로컬), true (Docker) | TLS 활성화 |
| `SSL_CERT` / `SSL_KEY` | `/certs/{cert,privkey}.pem` | 인증서 경로 |
| `FRONTEND_URL` | `http://frontend:3000` | 프록시 대상 |
| `POOL_WORKERS` | 0 (= `availableProcessors()`) | 가상 스레드 워커 수 |
| `POOL_QUEUE` | 1024 | 레인 당 큐 용량 |
| `POOL_FAST_THRESHOLD` | 4096 | fast 레인 진입 바이트 임계값 |
| `JSON_INDENT` | false | 응답 JSON 들여쓰기 (dev) |

## 의존성

- Java ≥ 21
- Maven ≥ 3.9
- Spring Boot 4.0.2 (Spring Framework 7, Jakarta EE 11)
- Jackson 3.0.4 (`tools.jackson.databind`)
- Node ≥ 18, npm

서드파티 비즈니스 라이브러리는 사용하지 않습니다 — Spring Boot `spring-boot-starter-web` 만 사용하며,
도메인 계산 로직은 표준 라이브러리(`java.time`, `java.util`, `java.math.BigDecimal`)로만 작성되어 있습니다.

## 데스크톱 배포 (Mode B) — 뜌땨 생활행정

서버 배포(`docker compose up -d`, **Mode A**) 는 그대로 유지됩니다. 별도로 일반 사용자가
**더블클릭으로 설치**하는 데스크톱 빌드(브랜드명 **「뜌땨 생활행정」**, ASCII 코드명 `tyutya`)
를 함께 제공합니다.

```
desktop/                       ← Electron 셸 + 빌드 스크립트 (단일 코드베이스 공유)
├── electron/                  ← TS — main · preload · 자식 프로세스 매니저 · 첫 실행 마법사
├── splash/                    ← 부팅 진행 표시 (한국어)
├── scripts/                   ← jlink JRE · 자원 모음 · FreeBSD 번들
├── build/                     ← 아이콘 · NSIS 커스텀 · macOS entitlements
└── package.json               ← electron-builder 설정 일체
```

배포 산출물:

| OS       | 산출물                                  | 설치 방식                    |
|----------|-----------------------------------------|------------------------------|
| Windows  | `Tyutya-Setup-x.y.z.exe` (NSIS)         | 더블클릭 → 다음·설치        |
| macOS    | `Tyutya-x.y.z-arm64.dmg` / `-x64.dmg`   | DMG 열기 → Applications 드롭 |
| Linux    | `Tyutya-x.y.z-x64.AppImage`             | 더블클릭 → 자동 설치 마법사 |
| FreeBSD  | `Tyutya-freebsd.txz`                    | 풀고 `register.sh` 더블클릭 |

### 사용자 경험

모든 OS 동일:

```
다운로드 → 더블클릭 → 설치 → 응용프로그램 / 시작 메뉴에 등록 → 실행
```

사용자가 **터미널·chmod·docker·java·node 를 절대 다루지 않습니다**.
설치 위치는 항상 사용자 영역(per-user):

| OS       | 설치 경로                                                   |
|----------|-------------------------------------------------------------|
| Windows  | `%LOCALAPPDATA%\Tyutya`                                    |
| macOS    | `/Applications/뜌땨 생활행정.app` (사용자 권한만 필요)      |
| Linux    | `~/.local/share/tyutya/`                                   |
| FreeBSD  | `~/.local/share/tyutya/`                                   |

### Linux 첫 실행 마법사

다운로드 받은 AppImage 를 더블클릭하면 — `chmod` 없이 — 본 앱이 자동으로:

1. 자기 자신을 `~/.local/share/tyutya/` 로 복사
2. 아이콘을 `~/.local/share/icons/hicolor/512x512/apps/tyutya.png` 에 등록
3. `tyutya.desktop` 항목을 `~/.local/share/applications/` 에 작성
4. `update-desktop-database` / `xdg-desktop-menu` / `gtk-update-icon-cache` 자동 실행
5. 설치본을 새로 띄우고 원본 인스턴스 종료

KDE Plasma · GNOME · XFCE · Cinnamon · MATE · LXQt 모두 별도 작업 없이 메뉴/검색에 등록.
**root 권한 / `/opt` / `/usr` 설치 절대 없음.**

### 데스크톱 부팅 시퀀스

```
splash 표시
  → "내부 계산 엔진을 시작하는 중…"
  → jlink JRE 가 backend.jar 를 임의 포트에서 기동
  → "사용자 인터페이스를 준비하는 중…"
  → Next standalone server.js 가 BACKEND_URL=내부 포트 로 기동
  → /api/health 통과 후 splash → 대시보드 로 전환
```

자식 프로세스의 stdout/stderr 는 사용자 데이터 폴더 `logs/` 에만 누적되며 콘솔 창은
열리지 않습니다.

### 고급 모드

메뉴 [고급 → 로그 폴더 열기 / 버전 정보 / 업데이트 확인 / 개발자 도구]. 평소 사용자에게는
숨겨진 영역이며, 기술자가 진단할 때만 사용.

### 빌드 명령어

```bash
make desktop-install       # desktop/ npm install
make desktop-prepare       # backend.jar + Next standalone 을 desktop/build 로 모음
make desktop-jre           # jlink — desktop/build/jre 에 최소 JRE 생성
make desktop-dev           # 로컬 Electron 개발 모드 (외부 dev 서버 사용 가능)

make package-windows       # NSIS 설치본 → desktop/out/*.exe
make package-macos         # DMG → desktop/out/*.dmg
make package-linux         # AppImage → desktop/out/*.AppImage
make package-freebsd       # FreeBSD .txz → desktop/out/*.txz
```

각 패키지 빌드는 **해당 OS 호스트** 에서 실행해야 합니다. 운영자는 `.github/workflows/package.yml`
의 매트릭스(Windows / macOS / Ubuntu / FreeBSD VM)로 4종 모두 자동화할 수 있습니다.

### 코드 서명

| OS       | 환경 변수 / Secrets                                                         |
|----------|-----------------------------------------------------------------------------|
| Windows  | `CSC_LINK` (PFX base64), `CSC_KEY_PASSWORD`                                |
| macOS    | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Linux    | (서명 생략 — AppImage 는 GPG 서명 옵션은 별도)                              |
| FreeBSD  | (해당 없음)                                                                 |

서명 secrets 가 없으면 자동으로 unsigned 빌드 — 소규모 배포에서는 그대로 사용 가능.

### CI — 누락 릴리스 자동 백필

`.github/workflows/package.yml` 은 다음과 같이 동작합니다:

1. **모든 푸시(main / dev) 마다** `git tag -l 'v*'` 를 훑어 GitHub Release 가 없는 태그를 자동 추출.
2. 누락 태그가 0 개면 매트릭스 잡을 실행하지 않음 (CI 비용 0).
3. 누락 태그가 있으면 (tag × OS) 매트릭스로 빌드 — 실 VM:
   - **Windows**: `windows-latest` (Azure Windows Server VM)
   - **macOS**:   `macos-13` (Intel) + `macos-14` (Apple Silicon) 실 VM
   - **Linux**:   `ubuntu-22.04` 실 VM
   - **FreeBSD**: `vmactions/freebsd-vm@v1` (release **14.2**) — 진짜 FreeBSD 14.2 VM 위에서 `pkg` 의 electron31 + openjdk21 + node20 으로 네이티브 빌드.
4. `release` 잡이 태그별로 GitHub Release 를 생성하고 4종 산출물을 부착.

수동 빌드도 가능 — Actions 탭의 `Run workflow` → `force_tag: v0.2.0` 을 입력하면 그 태그만 강제 백필.

### Mode A (서버) vs Mode B (데스크톱)

- 두 모드는 **동일한 Java 백엔드 + 동일한 Next.js 프런트엔드** 를 공유합니다.
- 비즈니스 로직은 어디에도 중복되지 않습니다 — 데스크톱은 단지 Electron 셸 + jlink JRE 를 추가로 묶을 뿐입니다.
- 기존 `docker compose up -d` 흐름은 **그대로 유지** 되며 본 패키징 시스템의 영향을 받지 않습니다.
