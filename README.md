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
