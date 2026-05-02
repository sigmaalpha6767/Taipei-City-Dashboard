package tools

// 食安 AI 應變中樞 — BE tool registry（postgres-data 版）
//
// 對齊資料端→BE→FE 標準路徑：
//   raw CSV (component4/scripts) → postgres-data.food_inspection_raw 表
//                                  → 此處 SQL 聚合 → LLM tool result
//
// 4 個工具 LLM 可呼叫：
//   - get_food_risk_summary
//   - get_top_recidivists(limit)
//   - get_vulnerable_exposure
//   - get_district_risk(city, limit)

import (
	"TaipeiCityDashboardBE/app/models"
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// === Tool 1: get_food_risk_summary ===

type sampleAgg struct {
	SampleName        string  `gorm:"column:sample_name"`
	FailCount         int     `gorm:"column:fail_count"`
	MainViolationType string  `gorm:"column:main_violation_type"`
	DistrictCount     int     `gorm:"column:district_count"`
}

type districtAgg struct {
	City              string `gorm:"column:city"`
	District          string `gorm:"column:district"`
	FailCount         int    `gorm:"column:fail_count"`
	MainViolationType string `gorm:"column:main_violation_type"`
}

type violationAgg struct {
	ViolationType string `gorm:"column:violation_type"`
	Cnt           int    `gorm:"column:cnt"`
}

func GetFoodRiskSummary(ctx context.Context, args string) (string, error) {
	var totalFailCount int64
	var earliest, latest *string

	if err := models.DBDashboard.Table("food_inspection_raw").Count(&totalFailCount).Error; err != nil {
		return "", fmt.Errorf("query total failed: %v", err)
	}
	row := models.DBDashboard.Raw(
		`SELECT MIN(test_date)::text earliest, MAX(test_date)::text latest FROM food_inspection_raw`,
	).Row()
	_ = row.Scan(&earliest, &latest)

	var samples []sampleAgg
	models.DBDashboard.Raw(`
		SELECT sample_name,
		       COUNT(*) fail_count,
		       MODE() WITHIN GROUP (ORDER BY violation_type) main_violation_type,
		       COUNT(DISTINCT district) FILTER (WHERE district != '未知') district_count
		FROM food_inspection_raw
		GROUP BY sample_name
		ORDER BY fail_count DESC
		LIMIT 5
	`).Scan(&samples)

	var districts []districtAgg
	models.DBDashboard.Raw(`
		SELECT city, district,
		       COUNT(*) fail_count,
		       MODE() WITHIN GROUP (ORDER BY violation_type) main_violation_type
		FROM food_inspection_raw
		WHERE city IN ('臺北市','新北市') AND district != '未知'
		GROUP BY city, district
		ORDER BY fail_count DESC
		LIMIT 5
	`).Scan(&districts)

	var vbreak []violationAgg
	models.DBDashboard.Raw(`
		SELECT violation_type, COUNT(*) cnt
		FROM food_inspection_raw
		GROUP BY violation_type
		ORDER BY cnt DESC
	`).Scan(&vbreak)

	violationBreakdown := map[string]int{}
	for _, v := range vbreak {
		violationBreakdown[v.ViolationType] = v.Cnt
	}

	out := map[string]interface{}{
		"total_fail_count":    totalFailCount,
		"date_range":          map[string]interface{}{"start": earliest, "end": latest},
		"top_samples":         formatSampleAggs(samples),
		"top_districts":       formatDistrictAggs(districts),
		"violation_breakdown": violationBreakdown,
	}
	b, _ := json.Marshal(out)
	return string(b), nil
}

// === Tool 2: get_top_recidivists ===

type topRecidivistArgs struct {
	Limit int `json:"limit"`
}

type recidivistRow struct {
	StoreName         string `gorm:"column:store_name"`
	FailCount         int    `gorm:"column:fail_count"`
	City              string `gorm:"column:city"`
	MainViolationType string `gorm:"column:main_violation_type"`
	Districts         string `gorm:"column:districts"` // 逗號分隔（PG string_agg）
	Samples           string `gorm:"column:samples"`
}

func GetTopRecidivists(ctx context.Context, args string) (string, error) {
	params := topRecidivistArgs{Limit: 5}
	if args != "" && args != "{}" {
		_ = json.Unmarshal([]byte(args), &params)
	}
	if params.Limit <= 0 || params.Limit > 30 {
		params.Limit = 5
	}

	// 在地店家（雙北 + 有 district）優先
	q := `
		SELECT store_name,
		       COUNT(*) fail_count,
		       (ARRAY_AGG(DISTINCT city))[1] city,
		       MODE() WITHIN GROUP (ORDER BY violation_type) main_violation_type,
		       STRING_AGG(DISTINCT district, ',') FILTER (WHERE district != '未知') districts,
		       STRING_AGG(DISTINCT sample_name, ',') samples
		FROM food_inspection_raw
		WHERE store_name IS NOT NULL AND store_name != ''
		GROUP BY store_name
		HAVING COUNT(*) >= 2
		ORDER BY
		  CASE WHEN BOOL_OR(city IN ('臺北市','新北市')) AND BOOL_OR(district != '未知') THEN 0 ELSE 1 END,
		  COUNT(*) DESC
		LIMIT ?
	`
	var rows []recidivistRow
	if err := models.DBDashboard.Raw(q, params.Limit).Scan(&rows).Error; err != nil {
		return "", fmt.Errorf("recidivist query failed: %v", err)
	}

	items := make([]map[string]interface{}, 0, len(rows))
	for _, r := range rows {
		districts := splitCSV(r.Districts)
		samples := splitCSV(r.Samples)
		if len(samples) > 3 {
			samples = samples[:3]
		}
		entry := map[string]interface{}{
			"store":          r.StoreName,
			"fail_count":     r.FailCount,
			"city":           r.City,
			"main_violation": r.MainViolationType,
			"samples":        samples,
			"districts":      districts,
		}
		if len(districts) > 0 {
			entry["kind"] = "在地店家"
			entry["location_summary"] = strings.Join(districts, "、")
		} else {
			entry["kind"] = "食品供應商"
			entry["location_summary"] = "無雙北固定門市（供應商型違規，需查公司登記地址追溯）"
		}
		items = append(items, entry)
	}
	out := map[string]interface{}{
		"items": items,
		"count": len(items),
		"note":  "已優先列出有具體雙北行政區的在地店家；不足才補上食品供應商型違規。",
	}
	b, _ := json.Marshal(out)
	return string(b), nil
}

// === Tool 3: get_vulnerable_exposure ===
//
// 校園/長照影響仍由 FE 預備好的 vulnerable_exposure.json 提供
// （地理空間關聯需 GeoJSON + 場域名單，本期 component 4 已產好；後續若要 SQL 化
//  可建 vulnerable_facilities 表 + 跨表 join，這裡先保留 fallback）
//
// 本版改為從 food_inspection_raw 動態算「事件供應商」+ 受波及行政區，並用既有的
// vulnerable facilities GeoJSON 數字 fallback。

func GetVulnerableExposure(ctx context.Context, args string) (string, error) {
	// 找出累犯供應商（fail_count 最高且 districts 有覆蓋多區的）作為事件主體
	var topSupplier struct {
		StoreName         string  `gorm:"column:store_name"`
		FailCount         int     `gorm:"column:fail_count"`
		Sample            string  `gorm:"column:top_sample"`
		ViolationType     string  `gorm:"column:violation_type"`
		AffectedDistricts string  `gorm:"column:districts"`
	}
	models.DBDashboard.Raw(`
		SELECT store_name,
		       COUNT(*) fail_count,
		       (ARRAY_AGG(sample_name ORDER BY id))[1] top_sample,
		       MODE() WITHIN GROUP (ORDER BY violation_type) violation_type,
		       STRING_AGG(DISTINCT district, ',') FILTER (WHERE district != '未知') districts
		FROM food_inspection_raw
		WHERE store_name IS NOT NULL AND store_name != ''
		GROUP BY store_name
		ORDER BY fail_count DESC
		LIMIT 1
	`).Scan(&topSupplier)

	affectedDistricts := splitCSV(topSupplier.AffectedDistricts)

	out := map[string]interface{}{
		// 場域影響數字目前仍維持 component 4 既有估算（後續可改成 GIS join）
		"affected_schools":             67,
		"affected_kindergartens":       12,
		"affected_care_facilities":     4,
		"high_exposure_districts":      14,
		"estimated_exposed_population": 77602,
		"event_ingredient":             topSupplier.Sample,
		"event_supplier":               topSupplier.StoreName,
		"event_risk_type":              topSupplier.ViolationType,
		"event_fail_count":             topSupplier.FailCount,
		"affected_districts":           affectedDistricts,
		"affected_districts_count":     len(affectedDistricts),
	}
	b, _ := json.Marshal(out)
	return string(b), nil
}

// === Tool 4: get_district_risk ===

type districtRiskArgs struct {
	City  string `json:"city"`
	Limit int    `json:"limit"`
}

func GetDistrictRisk(ctx context.Context, args string) (string, error) {
	params := districtRiskArgs{City: "metrotaipei", Limit: 5}
	if args != "" && args != "{}" {
		_ = json.Unmarshal([]byte(args), &params)
	}
	if params.City == "" {
		params.City = "metrotaipei"
	}
	if params.Limit <= 0 || params.Limit > 41 {
		params.Limit = 5
	}

	cityFilter := ""
	switch params.City {
	case "taipei":
		cityFilter = "AND city = '臺北市'"
	case "newtaipei":
		cityFilter = "AND city = '新北市'"
	case "metrotaipei":
		cityFilter = "AND city IN ('臺北市','新北市')"
	default:
		return "", fmt.Errorf("city %s not supported, valid: taipei / newtaipei / metrotaipei", params.City)
	}

	var rows []districtAgg
	q := fmt.Sprintf(`
		SELECT city, district,
		       COUNT(*) fail_count,
		       MODE() WITHIN GROUP (ORDER BY violation_type) main_violation_type
		FROM food_inspection_raw
		WHERE district != '未知' %s
		GROUP BY city, district
		ORDER BY fail_count DESC
		LIMIT ?
	`, cityFilter)
	if err := models.DBDashboard.Raw(q, params.Limit).Scan(&rows).Error; err != nil {
		return "", fmt.Errorf("district risk query failed: %v", err)
	}

	out := map[string]interface{}{
		"city":  params.City,
		"items": formatDistrictAggs(rows),
		"count": len(rows),
	}
	b, _ := json.Marshal(out)
	return string(b), nil
}

// === Helpers ===

func formatSampleAggs(arr []sampleAgg) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(arr))
	for _, s := range arr {
		out = append(out, map[string]interface{}{
			"name":           s.SampleName,
			"count":          s.FailCount,
			"main_violation": s.MainViolationType,
			"district_count": s.DistrictCount,
		})
	}
	return out
}

func formatDistrictAggs(arr []districtAgg) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(arr))
	for _, x := range arr {
		out = append(out, map[string]interface{}{
			"city":           x.City,
			"district":       x.District,
			"count":          x.FailCount,
			"main_violation": x.MainViolationType,
		})
	}
	return out
}

func splitCSV(s string) []string {
	if s == "" {
		return []string{}
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" && p != "未知" {
			out = append(out, p)
		}
	}
	return out
}

// === 註冊 ===

func init() {
	Register("get_food_risk_summary", GetFoodRiskSummary)
	Register("get_top_recidivists", GetTopRecidivists)
	Register("get_vulnerable_exposure", GetVulnerableExposure)
	Register("get_district_risk", GetDistrictRisk)
}
