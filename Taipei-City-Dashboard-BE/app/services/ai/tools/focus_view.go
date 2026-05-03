package tools

// UI 指令型 tool — 跟其他資料查詢 tool 不同，不查 DB，只把 LLM 想讓 FE 顯示的「組件 + filter」
// 結構化參數記錄下來。BE 把 tool args 透過 response.tool_calls 帶回 FE，FE 自己解析後
// 切換地圖到對應組件並套用 filter。LLM 只負責「決定要看什麼」，UI 動作交給 FE。
//
// 為什麼是 tool 而不是 BE 端直接做 UI 動作：
//   1. BE 沒有 UI session 概念（純 stateless API）
//   2. 透過 tool calling，LLM 可以同時呼叫資料 tool（如 get_district_risk）+ UI tool，
//      讓對話分析跟畫面焦點同步
//   3. 政府接手時可以重用此 tool 對接其他前端（eg. line bot 用相同 tool 推卡片）

import (
	"TaipeiCityDashboardBE/app/models"
	"context"
	"encoding/json"
	"fmt"
)

type focusViewArgs struct {
	ComponentIndex string                 `json:"component_index"`
	City           string                 `json:"city,omitempty"`
	Filters        map[string]interface{} `json:"filters,omitempty"`
	Reason         string                 `json:"reason,omitempty"`
}

func FocusDashboardView(ctx context.Context, args string) (string, error) {
	if args == "" || args == "{}" {
		return "", fmt.Errorf("focus_dashboard_view 需要傳入 component_index")
	}

	var p focusViewArgs
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", fmt.Errorf("invalid args JSON: %v", err)
	}
	if p.ComponentIndex == "" {
		return "", fmt.Errorf("component_index 不可為空")
	}

	// 驗證 component_index 真的存在於 components 表 — 防 LLM 編造（如 "0", "1", "abc"）。
	// 失敗時把 valid index 清單回給 LLM，下一輪它能自我修正。
	valid, validList, validErr := isValidComponentIndex(p.ComponentIndex)
	if validErr == nil && !valid {
		out := map[string]interface{}{
			"status":          "error",
			"action":          "focus_view",
			"component_index": p.ComponentIndex,
			"reason":          fmt.Sprintf("component_index '%s' 不存在於組件資料庫，請從以下實際存在的 index 挑選：", p.ComponentIndex),
			"valid_indices":   validList,
			"hint":            "請改用 valid_indices 中的字串值（不是序號）重新呼叫，或省略此工具直接回答。",
		}
		b, _ := json.Marshal(out)
		return string(b), nil
	}

	// echo 回 LLM — 讓 LLM 確認它「打算」做的事，避免下一輪又重複呼叫
	out := map[string]interface{}{
		"status":          "ok",
		"action":          "focus_view",
		"component_index": p.ComponentIndex,
		"city":            p.City,
		"filters":         p.Filters,
		"note":            "FE 已收到指令並將切換到此組件 + 套用 filter，請繼續完成你的分析回答，不要再呼叫此工具。",
	}
	b, _ := json.Marshal(out)
	return string(b), nil
}

// isValidComponentIndex 查 components 表確認 index 真實存在。
// 回傳 (是否有效, 全部 valid index 清單, 查詢錯誤)。查詢失敗時回 (true, nil, err)
// 讓上層 fallback 為「不驗證」，避免 DB 暫時掛掉就讓 tool 整個壞掉。
func isValidComponentIndex(idx string) (bool, []string, error) {
	rows, err := models.DBManager.Raw(
		`SELECT DISTINCT index FROM components WHERE index IS NOT NULL ORDER BY index`,
	).Rows()
	if err != nil {
		return true, nil, err
	}
	defer rows.Close()

	var found bool
	var all []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			continue
		}
		all = append(all, s)
		if s == idx {
			found = true
		}
	}
	return found, all, nil
}

func init() {
	Register("focus_dashboard_view", FocusDashboardView)
}
