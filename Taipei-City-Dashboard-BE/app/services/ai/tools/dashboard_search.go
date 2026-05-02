package tools

// 儀表板組件搜尋工具：把既有的 vector/component (Qdrant) 包成 LLM 可呼叫的 tool。
// 讓 LLM 在使用者問「我想看 XX 相關的儀表板」時主動呼叫這個工具，
// 後續 ChatBox.vue 收到 tool 結果後可以渲染成「建立儀表板」按鈕。

import (
	"TaipeiCityDashboardBE/app/models"
	"context"
	"encoding/json"
	"fmt"
)

type searchComponentsArgs struct {
	Query string  `json:"query"`
	Limit int     `json:"limit"`
	Score float64 `json:"score"`
}

func SearchDashboardComponents(ctx context.Context, args string) (string, error) {
	params := searchComponentsArgs{Limit: 8, Score: 0.78}
	if args != "" && args != "{}" {
		_ = json.Unmarshal([]byte(args), &params)
	}
	if params.Query == "" {
		return "", fmt.Errorf("query 參數必填，請傳入要搜尋的儀表板組件描述")
	}
	if params.Limit <= 0 || params.Limit > 30 {
		params.Limit = 8
	}
	if params.Score <= 0 || params.Score > 1 {
		params.Score = 0.78
	}

	results, err := models.GetComponentByQueryVector(params.Query, params.Limit, params.Score)
	if err != nil {
		// qdrant 沒啟動 / collection 沒建好時，不要把 LLM 帶進無限 retry 迴圈，
		// 直接回友善訊息，讓 LLM 用文字回覆使用者「目前無法搜尋」。
		out := map[string]interface{}{
			"count":   0,
			"items":   []interface{}{},
			"warning": fmt.Sprintf("組件向量索引目前無法存取（%v）。請告訴使用者：『目前組件搜尋暫不可用，可嘗試直接到左側儀表板列表瀏覽』。", err),
		}
		b, _ := json.Marshal(out)
		return string(b), nil
	}

	items := make([]map[string]interface{}, 0, len(results))
	for _, r := range results {
		items = append(items, map[string]interface{}{
			"id":    r.ID,
			"index": r.Index,
			"name":  r.Name,
			"city":  r.City,
			"score": r.Score,
		})
	}
	out := map[string]interface{}{
		"count": len(items),
		"items": items,
	}
	b, _ := json.Marshal(out)
	return string(b), nil
}

func init() {
	Register("search_dashboard_components", SearchDashboardComponents)
}
