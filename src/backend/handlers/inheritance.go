package handlers

import (
	"net/http"
	"strings"

	"opengovsupport/backend/domain"
)

// 04_상속상담 — 「민법」 제1009조 법정 상속분 산출.

func registerInheritance(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/inheritance/consult", handleInheritanceConsult)
}

type inheritanceBody struct {
	Target      string  `json:"target"`
	TotalAmount float64 `json:"totalAmount"`
	SpouseCount int     `json:"spouseCount"`
	ChildCount  int     `json:"childCount"`
	ParentCount int     `json:"parentCount"`
}

func handleInheritanceConsult(w http.ResponseWriter, r *http.Request) {
	rawBody, err := decodeAny(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "요청을 해석하지 못했습니다: "+err.Error())
		return
	}
	b := inheritanceBody{
		Target:      domain.ToString(rawBody["target"]),
		TotalAmount: domain.ToFloat(rawBody["totalAmount"]),
		SpouseCount: int(domain.ToFloat(rawBody["spouseCount"])),
		ChildCount:  int(domain.ToFloat(rawBody["childCount"])),
		ParentCount: int(domain.ToFloat(rawBody["parentCount"])),
	}

	if b.ChildCount >= 1 && b.ParentCount >= 1 {
		writeError(w, http.StatusBadRequest, "자녀와 부모는 동시에 상속을 할 수 없습니다. 확인 바랍니다.")
		return
	}

	share := domain.ComputeInheritance(b.TotalAmount, b.SpouseCount, b.ChildCount, b.ParentCount)

	var sb strings.Builder
	sb.WriteString("[상속 지분 계산]\n")
	sb.WriteString("* 대상물건: " + b.Target + "\n")
	sb.WriteString("* 상속가액: " + domain.Won(b.TotalAmount) + "\n")
	sb.WriteString("* 상속지분 (배우자 1.5 : 직계 1.0)\n")

	if b.SpouseCount >= 1 {
		sb.WriteString("  - 배우자 " + itoa(b.SpouseCount) + "명: " + domain.Won(share.SpouseShare*float64(b.SpouseCount)) +
			" (1인 " + domain.Won(share.SpouseShare) + ")\n")
	} else {
		sb.WriteString("  - 배우자: 없음\n")
	}

	switch {
	case b.ChildCount >= 1:
		sb.WriteString("  - 자녀 " + itoa(b.ChildCount) + "명: ")
		sb.WriteString(domain.Won(share.ChildTotal))
		sb.WriteString(" (자녀1인지분: " + domain.Won(share.ChildPer) + ")\n")
	case b.ParentCount >= 1:
		sb.WriteString("  - 부모 " + itoa(b.ParentCount) + "명: ")
		sb.WriteString(domain.Won(share.ParentTotal))
		sb.WriteString(" (부모1인지분: " + domain.Won(share.ParentPer) + ")\n")
	default:
		sb.WriteString("  - 자녀/부모: 없음\n")
	}

	writeJSON(w, http.StatusOK, Result{
		Title: "상속 지분 안내",
		Text:  sb.String(),
		Data: map[string]any{
			"target":      b.Target,
			"totalAmount": b.TotalAmount,
			"spouse":      map[string]any{"count": b.SpouseCount, "share": share.SpouseShare, "total": share.SpouseShare * float64(b.SpouseCount)},
			"child":       map[string]any{"count": b.ChildCount, "total": share.ChildTotal, "per": share.ChildPer},
			"parent":      map[string]any{"count": b.ParentCount, "total": share.ParentTotal, "per": share.ParentPer},
		},
	})
}
