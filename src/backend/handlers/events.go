package handlers

import (
	"net/http"
	"strings"

	"opengovsupport/backend/domain"
)

// 00_workbook_events — simulates the cell-change side effects for the
// 재산변동상담생성 화면 (행 숨김/표시 + C10/C17 차액 자동계산).

func registerEvents(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/events/property-sheet", handlePropertySheetEvent)
}

func handlePropertySheetEvent(w http.ResponseWriter, r *http.Request) {
	body, err := decodeAny(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "요청을 해석하지 못했습니다: "+err.Error())
		return
	}
	mode := strings.TrimSpace(domain.ToString(body["mode"]))
	c8 := domain.ToFloat(body["c8"])
	c9 := domain.ToFloat(body["c9"])
	c13 := domain.ToFloat(body["c13"])
	c14 := domain.ToFloat(body["c14"])

	hidden := []string{}
	visible := []string{"2:21"}
	switch mode {
	case "금융재산":
		hidden = []string{"5:6", "11:17"}
	case "일반재산":
		hidden = []string{"5:6", "8:10", "13:17"}
	case "주택조사결과":
		hidden = []string{"8:12"}
	case "선택":
		hidden = []string{"4:21"}
	}

	c10 := c9 - c8
	c17 := c14 - c13

	var sb strings.Builder
	sb.WriteString("[재산변동상담생성 시트 시뮬레이션]\n")
	sb.WriteString("* C3 모드 : " + mode + "\n")
	sb.WriteString("* 표시되는 행 : " + strings.Join(visible, ",") + "\n")
	if len(hidden) > 0 {
		sb.WriteString("* 숨겨지는 행 : " + strings.Join(hidden, ",") + "\n")
	}
	sb.WriteString("* C10 (= C9 - C8) : " + domain.Won(c10) + "\n")
	sb.WriteString("* C17 (= C14 - C13) : " + domain.Won(c17) + "\n")

	writeJSON(w, http.StatusOK, Result{
		Title: "재산변동상담생성 시트 동작",
		Text:  sb.String(),
		Data: map[string]any{
			"mode":    mode,
			"c10":     c10,
			"c17":     c17,
			"hidden":  hidden,
			"visible": visible,
		},
	})
}
