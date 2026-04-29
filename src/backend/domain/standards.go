package domain

// 법령에 근거한 공개 기준값. 보건복지부 고시(중위소득·기초연금·재산공제 등)와
// 「민법」(상속분), 국민기초생활보장법 시행령(사적이전소득 산정·이자소득 공제)
// 의 수치를 코드에 직접 박아 둔다. 수치 근거가 변경될 경우 이 파일만 갱신한다.

// SupportedYears는 표가 보유한 연도 (최신연도가 앞).
var SupportedYears = []int{2026, 2025}

// MedianIncome[년도][가구원수] = 가구원수별 기준 중위소득 (월, 원).
// 1인~8인 가구. 7~8인은 6인 가구 대비 가구원수당 추가율을 적용한 산식 결과.
var MedianIncome = map[int]map[int]int{
	2026: {
		1: 2_564_238, 2: 4_199_292, 3: 5_359_036, 4: 6_494_738,
		5: 7_556_719, 6: 8_555_952, 7: 9_573_575, 8: 10_591_197,
	},
	2025: {
		1: 2_392_013, 2: 3_932_658, 3: 5_025_353, 4: 6_097_773,
		5: 7_108_192, 6: 8_064_805, 7: 8_988_428, 8: 9_912_051,
	},
}

// LivingBenefitRate = 생계급여 선정기준 (기준 중위소득 대비 비율).
var LivingBenefitRate = map[int]float64{
	2026: 0.32,
	2025: 0.32,
}

// PrivateIncomeFreqThreshold = 사적이전소득 횟수 기준.
// 횟수 미만(<7)이면 50% 공제, 이상이면 15% 공제.
const (
	PrivateIncomeFreqThreshold = 7
	PrivateIncomeRateUnder     = 0.50 // 횟수 미만 공제 비율
	PrivateIncomeRateOver      = 0.15 // 횟수 초과 공제 비율
)

// 사적이전소득 적용 기준액 = (기준 중위소득 × 50%) × 가구원수 비율.
// 가구원수 1인의 경우 PrivateIncomeMonthly(2026, 1) → 1,282,119.
func PrivateIncomeMonthly(year, household int) int {
	mi, ok := MedianIncome[year][household]
	if !ok {
		return 0
	}
	return int(float64(mi) * PrivateIncomeRateUnder)
}

// PrivateIncomeAlt = 차상위 등 특수가구(횟수 초과) 적용 기준액.
func PrivateIncomeAlt(year, household int) int {
	mi, ok := MedianIncome[year][household]
	if !ok {
		return 0
	}
	return int(float64(mi) * PrivateIncomeRateOver)
}

// OtherGiftRate = 「국민기초생활보장사업안내」기타증여재산 공제율 (월).
// 기준일~조사일까지의 누적 차감액 산정에 사용.
var OtherGiftRate = map[int]float64{
	2026: 0.50,
	2025: 0.50,
}

// CustomBaseAmount = 맞춤형 급여 가구원수별 기준액 (생계급여 + 의료/주거/교육 통합).
// 단위: 원/월. 기타증여재산 외에 가구원수에 따른 항목으로도 사용된다.
var CustomBaseAmount = map[int]map[int]int{
	2026: {
		1: 1_282_119, 2: 2_099_646, 3: 2_679_518, 4: 3_247_369,
		5: 3_778_360, 6: 4_277_976, 7: 4_786_787, 8: 5_295_599,
	},
	2025: {
		1: 1_196_007, 2: 1_966_329, 3: 2_512_677, 4: 3_048_887,
		5: 3_554_096, 6: 4_032_403, 7: 4_494_214, 8: 4_956_026,
	},
}

// BasicPensionAmount = 기초연금 단독/부부 가구별 월 기준액.
// 「기초연금법」제5조 및 보건복지부 고시.
type PensionAmount struct {
	Single int // 단독가구 (월, 원)
	Couple int // 부부가구 (월, 원)
	Stipend int // 지급액 (월, 원)
	BasicDeduction int // 기본공제 (만원 단위로 표기되는 항목 → 원)
}

var BasicPension = map[int]PensionAmount{
	2026: {Single: 2_470_000, Couple: 3_952_000, Stipend: 349_700, BasicDeduction: 1_160_000},
	2025: {Single: 2_228_000, Couple: 3_648_000, Stipend: 342_510, BasicDeduction: 1_120_000},
}

// DisabilityPension = 장애인연금 단독/부부 가구별 월 기준액.
var DisabilityPension = map[int]PensionAmount{
	2026: {Single: 1_400_000, Couple: 2_240_000, Stipend: 349_700, BasicDeduction: 950_000},
	2025: {Single: 1_380_000, Couple: 2_208_000, Stipend: 342_510, BasicDeduction: 920_000},
}

// SeparateHouseholdLimit = 별도가구 인정 기준 (지역별 일반재산 한도).
// 단위: 만원. 보건복지부「국민기초생활보장사업안내」기준.
var SeparateHouseholdLimit = map[string]int{
	"대도시":     35_000,
	"중소도시":    25_000,
	"농어촌":     22_000,
	"서울":      36_400,
	"경기":      29_400,
	"광역세종창원": 28_400,
	"그외도시":    19_500,
}

// IncomeAssessmentRate = 소득평가액 산정 시 가구별 차감 비율.
// (기본/지생보 심의기준/수급자 취약계층/별도가구/별도가구(장애인)/자립지원/의료자립지원/혼인한 딸)
type AssessmentRate struct {
	Recipient float64 // 수급(권)자 비율
	Supporter float64 // 부양의무자 비율
}

var IncomeAssessmentRates = map[string]AssessmentRate{
	"기본":         {Recipient: 0.40, Supporter: 1.00},
	"지생보 심의기준":   {Recipient: 0.40, Supporter: 1.00},
	"수급자 취약계층":   {Recipient: 0.40, Supporter: 0.74},
	"별도가구":       {Recipient: 0,    Supporter: 1.40},
	"별도가구(장애인)":  {Recipient: 0,    Supporter: 1.70},
	"자립지원":       {Recipient: 0,    Supporter: 1.70},
	"의료자립지원":     {Recipient: 0.40, Supporter: 1.00},
	"혼인한 딸":      {Recipient: 0,    Supporter: 1.00},
}

// PropertyConversionRate = 재산을 소득으로 환산할 때의 비율(월).
// 기본 18%, 지생보 심의기준 60% (수급(권)자/부양의무자 동일 비율 적용).
var PropertyConversionRate = map[string]float64{
	"기본":       0.18,
	"지생보 심의기준": 0.60,
}

// CareReductionRatio = 차상위 본인부담경감 가구원수별 가산 비율.
// (1인 1.2 / 2인 1.3 / … / 7인 1.8)
var CareReductionRatio = map[int]float64{
	1: 1.2, 2: 1.3, 3: 1.4, 4: 1.5, 5: 1.6, 6: 1.7, 7: 1.8,
}

// InterestDeductionCap = 이자소득 추가공제 기준(연 한도, 원).
// 항목별: 맞춤형 / 기초연금 / 타법 (단위는 원이며, 12로 나눠 월 한도로 사용).
var InterestDeductionCap = map[string]int{
	"맞춤형":  20_000,
	"기초연금": 40_000,
	"타법":   10_000,
}

// SupporterBaseDeduction = 부양의무자 기본재산공제액 (지역별, 만원).
// 별도가구·차상위본인부담경감 별도 기준은 SeparateHouseholdLimit / CareReductionRatio.
var SupporterBaseDeduction = SeparateHouseholdLimit

// HousingBenefitLimit = 임차가구 주거급여 가구원수·급지별 월 상한액 (원).
var HousingBenefitLimit = map[int]map[int]map[int]int{
	2026: {
		1: {1: 369_000, 2: 300_000, 3: 247_000, 4: 212_000},
		2: {1: 414_000, 2: 335_000, 3: 275_000, 4: 238_000},
		3: {1: 492_000, 2: 401_000, 3: 327_000, 4: 283_000},
		4: {1: 571_000, 2: 463_000, 3: 381_000, 4: 329_000},
		5: {1: 591_000, 2: 479_000, 3: 394_000, 4: 340_000},
		6: {1: 699_000, 2: 568_000, 3: 463_000, 4: 402_000},
		7: {1: 768_900, 2: 624_800, 3: 509_300, 4: 442_200},
	},
	2025: {
		1: {1: 352_000, 2: 281_000, 3: 228_000, 4: 191_000},
		2: {1: 395_000, 2: 314_000, 3: 254_000, 4: 215_000},
		3: {1: 470_000, 2: 375_000, 3: 302_000, 4: 256_000},
		4: {1: 545_000, 2: 433_000, 3: 351_000, 4: 297_000},
		5: {1: 564_000, 2: 448_000, 3: 363_000, 4: 307_000},
		6: {1: 667_000, 2: 531_000, 3: 428_000, 4: 363_000},
		7: {1: 733_000, 2: 584_000, 3: 470_000, 4: 399_000},
	},
}

// InheritanceShare = 「민법」제1009조에 따른 상속분 분배 결과.
// 배우자는 1.5, 자녀/부모 각 1.0 비율. 자녀·부모는 동일 순위로 동시 상속하지 않음.
type InheritanceShare struct {
	SpouseShare float64 // 배우자 1인분
	ChildPer    float64 // 자녀 1인분
	ChildTotal  float64 // 자녀 전체 합
	ParentPer   float64 // 부모(존비속이 없을 때) 1인분
	ParentTotal float64 // 부모 전체 합
}

// ComputeInheritance = 총상속가액·구성원 수로부터 법정 상속분을 산출.
// 자녀가 1인 이상이면 부모는 후순위라 0이 된다.
func ComputeInheritance(total float64, spouseCount, childCount, parentCount int) InheritanceShare {
	out := InheritanceShare{}
	switch {
	case childCount > 0:
		// 배우자 1.5, 자녀 각 1.0. 부모는 후순위로 0.
		denom := float64(childCount) + 1.5*float64(spouseCount)
		if denom <= 0 {
			return out
		}
		unit := total / denom
		out.ChildPer = unit
		out.ChildTotal = unit * float64(childCount)
		if spouseCount > 0 {
			out.SpouseShare = unit * 1.5
		}
	case parentCount > 0:
		// 직계비속이 없을 때 직계존속+배우자(1.5).
		denom := float64(parentCount) + 1.5*float64(spouseCount)
		if denom <= 0 {
			return out
		}
		unit := total / denom
		out.ParentPer = unit
		out.ParentTotal = unit * float64(parentCount)
		if spouseCount > 0 {
			out.SpouseShare = unit * 1.5
		}
	default:
		// 직계비속·존속 없음 → 배우자 단독.
		if spouseCount > 0 {
			out.SpouseShare = total / float64(spouseCount)
		}
	}
	return out
}

// CurrentYear는 표가 가지고 있는 가장 최신 연도를 반환.
func CurrentYear() int {
	return SupportedYears[0]
}
