package domain

import "strconv"

// Feature describes one user-facing calculator. The web UI builds its
// navigation directly from AllFeatures() so every feature is discoverable.
type Feature struct {
	ID          string  `json:"id"`          // URL slug, e.g. "private-income/calc"
	DomainKey   string  `json:"domainKey"`   // "01_사적이전소득"
	DomainTitle string  `json:"domainTitle"` // "사적이전소득"
	Title       string  `json:"title"`       // "계산"
	Summary     string  `json:"summary"`     // one-line user-facing description
	Inputs      []Input `json:"inputs"`
}

// Input describes a single form field rendered by the frontend.
type Input struct {
	Name        string   `json:"name"`
	Label       string   `json:"label"`
	Kind        string   `json:"kind"`        // "text" | "number" | "date" | "textarea" | "select" | "rows"
	Placeholder string   `json:"placeholder,omitempty"`
	Default     string   `json:"default,omitempty"`
	Help        string   `json:"help,omitempty"`
	Options     []string `json:"options,omitempty"`
	Columns     []Input  `json:"columns,omitempty"` // for kind="rows"
	Required    bool     `json:"required,omitempty"`
}

func itoa(n int) string { return strconv.Itoa(n) }

// yearOptions returns the supported reference years as decimal strings,
// most recent first — used by every feature that depends on yearly tables.
func yearOptions() []string {
	out := make([]string, len(SupportedYears))
	for i, y := range SupportedYears {
		out[i] = itoa(y)
	}
	return out
}

// AllFeatures lists every endpoint the UI exposes. Defaults reference the
// law-based tables in standards.go so a fresh form is already populated with
// the current statutory values; users override per casework as needed.
func AllFeatures() []Feature {
	year := CurrentYear()

	return []Feature{
		// ── 01 사적이전소득 ───────────────────────────────────────────
		{
			ID: "private-income/calc",
			DomainKey: "01_사적이전소득", DomainTitle: "사적이전소득",
			Title: "계산", Summary: "월별 입금 내역에서 사적이전소득을 산출합니다.",
			Inputs: []Input{
				{Name: "year", Label: "기준 연도", Kind: "select", Options: yearOptions(), Default: itoa(year)},
				{Name: "household", Label: "가구원 수", Kind: "number", Default: "1", Help: "법정 기준 중위소득 50% / 15% 표를 자동 적용합니다."},
				{Name: "altLabel", Label: "특수 가구 라벨", Kind: "text", Default: "차상위", Help: "B열 가구구분이 이 라벨과 같으면 횟수초과(15%) 기준 적용."},
				{Name: "rows", Label: "입력 데이터", Kind: "rows", Columns: []Input{
					{Name: "household", Label: "B 가구구분", Kind: "text"},
					{Name: "month", Label: "C 입금월", Kind: "text"},
					{Name: "depositor", Label: "D 입금자", Kind: "text"},
					{Name: "amount", Label: "E 입금액", Kind: "number"},
					{Name: "exclude", Label: "F 제외액", Kind: "number"},
				}},
			},
		},
		{
			ID: "private-income/record",
			DomainKey: "01_사적이전소득", DomainTitle: "사적이전소득",
			Title: "상담기록 텍스트", Summary: "계산 결과를 상담일지용 텍스트로 변환합니다.",
			Inputs: []Input{
				{Name: "rows", Label: "계산 결과 행", Kind: "rows", Columns: []Input{
					{Name: "household", Label: "가구구분", Kind: "text"},
					{Name: "month", Label: "입금월", Kind: "text"},
					{Name: "depositor", Label: "입금자", Kind: "text"},
					{Name: "amount", Label: "입금액", Kind: "number"},
					{Name: "income", Label: "사적이전소득", Kind: "number"},
				}},
			},
		},
		{
			ID: "private-income/pdf",
			DomainKey: "01_사적이전소득", DomainTitle: "사적이전소득",
			Title: "출력본 (PDF용 HTML)", Summary: "브라우저 인쇄/PDF 저장용 페이지를 생성합니다.",
			Inputs: []Input{
				{Name: "title", Label: "문서 제목", Kind: "text", Default: "사적이전소득 계산서"},
				{Name: "rows", Label: "출력 데이터", Kind: "rows", Columns: []Input{
					{Name: "household", Label: "가구구분", Kind: "text"},
					{Name: "month", Label: "입금월", Kind: "text"},
					{Name: "depositor", Label: "입금자", Kind: "text"},
					{Name: "amount", Label: "입금액", Kind: "number"},
					{Name: "income", Label: "사적이전소득", Kind: "number"},
				}},
			},
		},

		// ── 02 이자소득 ───────────────────────────────────────────────
		{
			ID: "interest-income/calc",
			DomainKey: "02_이자소득", DomainTitle: "이자소득",
			Title: "계산", Summary: "계좌별 이자소득의 누적 차감 후 잔액을 계산합니다.",
			Inputs: []Input{
				{Name: "category", Label: "급여 항목", Kind: "select", Options: []string{"맞춤형", "기초연금", "타법"}, Default: "맞춤형", Help: "선택 시 연 한도(맞춤형 20,000 / 기초연금 40,000 / 타법 10,000원)를 자동 적용."},
				{Name: "deductionCap", Label: "월별 차감 한도 (수동 보정)", Kind: "number", Default: "0", Help: "0이면 위 항목별 법정 한도를 사용합니다."},
				{Name: "rows", Label: "이자 입력", Kind: "rows", Columns: []Input{
					{Name: "account", Label: "계좌", Kind: "text"},
					{Name: "startMonth", Label: "시작월(YYYY-MM)", Kind: "text"},
					{Name: "endMonth", Label: "종료월(YYYY-MM)", Kind: "text"},
					{Name: "amount", Label: "이자 금액", Kind: "number"},
				}},
			},
		},
		{
			ID: "interest-income/record",
			DomainKey: "02_이자소득", DomainTitle: "이자소득",
			Title: "상담기록 텍스트", Summary: "이자소득 결과를 상담일지 텍스트로 변환합니다.",
			Inputs: []Input{
				{Name: "category", Label: "급여 항목", Kind: "select", Options: []string{"맞춤형", "기초연금", "타법"}, Default: "맞춤형"},
				{Name: "deductionCap", Label: "월별 차감 한도 (수동 보정)", Kind: "number", Default: "0"},
				{Name: "rows", Label: "이자 입력", Kind: "rows", Columns: []Input{
					{Name: "account", Label: "계좌", Kind: "text"},
					{Name: "month", Label: "월", Kind: "text"},
					{Name: "amount", Label: "이자", Kind: "number"},
				}},
			},
		},
		{
			ID: "interest-income/pdf",
			DomainKey: "02_이자소득", DomainTitle: "이자소득",
			Title: "출력본", Summary: "브라우저 인쇄/PDF 저장용 페이지를 생성합니다.",
			Inputs: []Input{
				{Name: "title", Label: "문서 제목", Kind: "text", Default: "이자소득 공제 상담서"},
				{Name: "rows", Label: "출력 데이터", Kind: "rows", Columns: []Input{
					{Name: "account", Label: "계좌", Kind: "text"},
					{Name: "month", Label: "월", Kind: "text"},
					{Name: "amount", Label: "이자", Kind: "number"},
					{Name: "deducted", Label: "차감 후", Kind: "number"},
				}},
			},
		},

		// ── 03 재산상담 ──────────────────────────────────────────────
		{
			ID: "property/consult",
			DomainKey: "03_재산상담", DomainTitle: "재산변동상담",
			Title: "상담생성", Summary: "재산 변동(금융/일반/주택조사)에 대한 상담 메시지를 만듭니다.",
			Inputs: []Input{
				{Name: "year", Label: "기준 연도", Kind: "select", Options: yearOptions(), Default: itoa(year)},
				{Name: "mode", Label: "구분", Kind: "select", Options: []string{"금융재산", "일반재산", "주택조사결과"}, Required: true},
				{Name: "previous", Label: "직전 금액", Kind: "number"},
				{Name: "current", Label: "금회 금액", Kind: "number"},
				{Name: "baselineDate", Label: "기준일", Kind: "date"},
				{Name: "currentDate", Label: "조사일", Kind: "date"},
				{Name: "category", Label: "세부 항목", Kind: "text", Help: "예: 예금, 토지, 단독주택 등"},
				{Name: "deductionRate", Label: "차감율 (수동 보정)", Kind: "number", Default: "0", Help: "0이면 연도별 기타증여재산 공제율(50%)을 자동 적용."},
				{Name: "monthlyDeduction", Label: "월 차감액 (수동)", Kind: "number", Default: "0"},
			},
		},

		// ── 04 상속상담 ──────────────────────────────────────────────
		{
			ID: "inheritance/consult",
			DomainKey: "04_상속상담", DomainTitle: "상속분상담",
			Title: "상담생성", Summary: "「민법」 제1009조 법정 상속분에 따라 배우자/자녀/부모 분배를 자동 계산합니다.",
			Inputs: []Input{
				{Name: "target", Label: "대상물건", Kind: "text", Default: ""},
				{Name: "totalAmount", Label: "상속가액", Kind: "number", Default: "0"},
				{Name: "spouseCount", Label: "배우자 수", Kind: "number", Default: "0"},
				{Name: "childCount", Label: "자녀 수", Kind: "number", Default: "0", Help: "자녀가 1인 이상이면 부모는 후순위로 0이 됩니다."},
				{Name: "parentCount", Label: "부모 수", Kind: "number", Default: "0"},
			},
		},

		// ── 05 긴급공제설명 ──────────────────────────────────────────
		{
			ID: "emergency/explain",
			DomainKey: "05_긴급공제설명", DomainTitle: "긴급공제설명",
			Title: "공제 설명 생성", Summary: "긴급 지원 대상자의 기간별 공제표와 안내문을 생성합니다.",
			Inputs: []Input{
				{Name: "year", Label: "기준 연도", Kind: "select", Options: yearOptions(), Default: itoa(year)},
				{Name: "startDate", Label: "지원 시작일", Kind: "date", Required: true},
				{Name: "endDate", Label: "지원 종료일", Kind: "date", Required: true},
				{Name: "householdSize", Label: "가구원 수", Kind: "number", Default: "1", Help: "기준 중위소득과 생계급여 비율(32%)을 자동 적용합니다."},
				{Name: "monthlyAmount", Label: "월 지원금액", Kind: "number", Default: "0"},
				{Name: "incomeBaseline", Label: "기준 중위소득 (수동 보정)", Kind: "number", Default: "0", Help: "0이면 연도/가구원 수로 자동 조회."},
				{Name: "deductionRate", Label: "차감율 (수동 보정)", Kind: "number", Default: "0", Help: "0이면 생계급여 선정기준(32%)을 자동 적용."},
			},
		},

		// ── 06 해외체류 ──────────────────────────────────────────────
		{
			ID: "overseas/new",
			DomainKey: "06_해외체류", DomainTitle: "해외체류",
			Title: "신규 신청자", Summary: "신청일 기준 출입국 내역으로 61일 룰을 검토합니다.",
			Inputs: []Input{
				{Name: "applicationDate", Label: "신청일", Kind: "date", Required: true},
				{Name: "trips", Label: "출입국 내역", Kind: "rows", Columns: []Input{
					{Name: "departure", Label: "출국일", Kind: "date"},
					{Name: "arrival", Label: "입국일", Kind: "date"},
				}},
			},
		},
		{
			ID: "overseas/existing",
			DomainKey: "06_해외체류", DomainTitle: "해외체류",
			Title: "기존 수급자", Summary: "기준일(180일 전) 이후 해외체류일을 합산합니다.",
			Inputs: []Input{
				{Name: "baselineDate", Label: "조사 기준일", Kind: "date", Required: true},
				{Name: "trips", Label: "출입국 내역", Kind: "rows", Columns: []Input{
					{Name: "departure", Label: "출국일", Kind: "date"},
					{Name: "arrival", Label: "입국일", Kind: "date"},
				}},
			},
		},
		{
			ID: "overseas/pension",
			DomainKey: "06_해외체류", DomainTitle: "해외체류",
			Title: "기초/장애인 연금 수급자", Summary: "출국 후 60일 초과 시점의 안내문을 생성합니다.",
			Inputs: []Input{
				{Name: "departureDate", Label: "출국일", Kind: "date", Required: true},
				{Name: "pensionType", Label: "연금 종류", Kind: "select", Options: []string{"기초연금", "장애인연금", "기초+장애인 모두"}, Required: true},
			},
		},
		{
			ID: "overseas/care",
			DomainKey: "06_해외체류", DomainTitle: "해외체류",
			Title: "차상위 본인부담경감", Summary: "출국 후 3개월 초과 시 자격 정지 안내를 생성합니다.",
			Inputs: []Input{
				{Name: "departureDate", Label: "출국일", Kind: "date", Required: true},
			},
		},

		// ── 99 공용 ──────────────────────────────────────────────────
		{
			ID: "shared/months",
			DomainKey: "99_공용", DomainTitle: "공용 유틸",
			Title: "개월수 계산", Summary: "두 날짜 사이의 개월 수를 계산합니다 (종료월 포함).",
			Inputs: []Input{
				{Name: "startDate", Label: "시작일", Kind: "date", Required: true},
				{Name: "endDate", Label: "종료일", Kind: "date", Required: true},
			},
		},
		{
			ID: "shared/initial-deduction",
			DomainKey: "99_공용", DomainTitle: "공용 유틸",
			Title: "초기 차감금액 계산",
			Summary: "기준일~조사일 사이의 누적 차감 금액을 항목별·연도별 법정 비율로 계산합니다.",
			Inputs: []Input{
				{Name: "category", Label: "항목", Kind: "select",
					Options: []string{"기타증여재산", "맞춤형 1인", "맞춤형 2인", "맞춤형 3인", "맞춤형 4인", "맞춤형 5인", "맞춤형 6인", "맞춤형 7인", "맞춤형 8인", "기초연금 1인", "기초연금 2인"},
					Default: "기타증여재산",
					Help:    "기준 표의 항목 중 하나. 기타증여재산은 월 50% 비율, 맞춤형/기초연금 N인은 가구원수별 월 기준액."},
				{Name: "baselineDate", Label: "기준일", Kind: "date", Required: true},
				{Name: "currentDate", Label: "조사일", Kind: "date", Required: true},
				{Name: "principal", Label: "원금 (기타증여재산일 때만)", Kind: "number", Default: "0", Help: "맞춤형/기초연금 항목 선택 시에는 무시되고 표의 월 기준액이 직접 사용됩니다."},
			},
		},

		// ── 00 통합문서 이벤트 ───────────────────────────────────────
		{
			ID: "events/property-sheet",
			DomainKey: "00_workbook_events", DomainTitle: "이벤트 핸들러",
			Title: "재산변동 시트 변경 시뮬레이션",
			Summary: "재산변동상담생성 화면의 행 숨김 + 차액 자동계산을 시뮬레이션합니다.",
			Inputs: []Input{
				{Name: "mode", Label: "C3 모드", Kind: "select", Options: []string{"금융재산", "일반재산", "주택조사결과", "선택"}, Required: true},
				{Name: "c8", Label: "C8 (금융 금회)", Kind: "number", Default: "0"},
				{Name: "c9", Label: "C9 (금융 직전)", Kind: "number", Default: "0"},
				{Name: "c13", Label: "C13 (주택 금회)", Kind: "number", Default: "0"},
				{Name: "c14", Label: "C14 (주택 직전)", Kind: "number", Default: "0"},
			},
		},
	}
}

// ByID returns the feature definition for a given URL slug.
func ByID(id string) (Feature, bool) {
	for _, f := range AllFeatures() {
		if f.ID == id {
			return f, true
		}
	}
	return Feature{}, false
}
