package controllers

// 食安抽驗 summary 端點 — 從 postgres-data.food_inspection_raw 聚合，
// 取代 FE 原本讀的靜態 /data/prepared/food_inspection.json。
//
// Path: GET /api/v1/food/summary
// Public（不需要 JWT），讓 dashboard component 與 AI Advisor view 都能用。

import (
	"TaipeiCityDashboardBE/app/models"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type fsSummary struct {
	TotalFailCount         int            `json:"total_fail_count"`
	EarliestDate           string         `json:"earliest_date"`
	LatestDate             string         `json:"latest_date"`
	HighRiskCategoryCount  int            `json:"high_risk_category_count"`
	InvolvedDistrictCount  int            `json:"involved_district_count"`
	ViolationTypeBreakdown map[string]int `json:"violation_type_breakdown"`
}

type fsSampleOut struct {
	SampleName        string   `json:"sample_name"`
	FailCount         int      `json:"fail_count"`
	MainViolationType string   `json:"main_violation_type"`
	Districts         []string `json:"districts"`
}

type fsDistrictOut struct {
	City              string  `json:"city"`
	District          string  `json:"district"`
	FailCount         int     `json:"fail_count"`
	MainViolationType string  `json:"main_violation_type"`
	RiskScore         float64 `json:"risk_score"`
	RiskLevel         string  `json:"risk_level"`
}

type fsRecidivistOut struct {
	StoreName         string   `json:"store_name"`
	FailCount         int      `json:"fail_count"`
	City              string   `json:"city"`
	MainViolationType string   `json:"main_violation_type"`
	Samples           []string `json:"samples"`
	Districts         []string `json:"districts"`
}

type fsViolationOut struct {
	SampleName     string `json:"sample_name"`
	StoreName      string `json:"store_name"`
	City           string `json:"city"`
	District       string `json:"district"`
	TestDate       string `json:"test_date"`
	ViolationType  string `json:"violation_type"`
	ReasonSummary  string `json:"reason_summary"`
}

// GetFoodSummary 是 GET /api/v1/food/summary 的 handler
func GetFoodSummary(c *gin.Context) {
	// === Summary ===
	var totalFail int64
	models.DBDashboard.Table("food_inspection_raw").Count(&totalFail)

	var srcCounts struct {
		Real int64 `gorm:"column:real"`
		Mock int64 `gorm:"column:mock"`
	}
	models.DBDashboard.Raw(
		`SELECT COUNT(*) FILTER (WHERE NOT is_mock) real,
		        COUNT(*) FILTER (WHERE is_mock) mock
		 FROM food_inspection_raw`,
	).Scan(&srcCounts)

	var dateRow struct {
		Earliest *string `gorm:"column:earliest"`
		Latest   *string `gorm:"column:latest"`
	}
	models.DBDashboard.Raw(
		`SELECT MIN(test_date)::text earliest, MAX(test_date)::text latest FROM food_inspection_raw`,
	).Scan(&dateRow)

	type vbRow struct {
		Vt  string `gorm:"column:vt"`
		Cnt int    `gorm:"column:cnt"`
	}
	var vbs []vbRow
	models.DBDashboard.Raw(
		`SELECT violation_type vt, COUNT(*) cnt FROM food_inspection_raw GROUP BY violation_type ORDER BY cnt DESC`,
	).Scan(&vbs)
	breakdown := map[string]int{}
	for _, v := range vbs {
		breakdown[v.Vt] = v.Cnt
	}

	var distinctDistricts int64
	models.DBDashboard.Raw(
		`SELECT COUNT(DISTINCT district) FROM food_inspection_raw WHERE district != '未知'`,
	).Row().Scan(&distinctDistricts)

	highRiskCategoryCount := 0
	for _, t := range []string{"重金屬", "農藥殘留", "微生物", "動物用藥"} {
		if n, ok := breakdown[t]; ok && n > 0 {
			highRiskCategoryCount++
		}
	}

	summary := fsSummary{
		TotalFailCount:         int(totalFail),
		EarliestDate:           strDeref(dateRow.Earliest),
		LatestDate:             strDeref(dateRow.Latest),
		HighRiskCategoryCount:  highRiskCategoryCount,
		InvolvedDistrictCount:  int(distinctDistricts),
		ViolationTypeBreakdown: breakdown,
	}

	// === samples (top by fail_count, with affected districts) ===
	var sampleRaw []struct {
		SampleName        string `gorm:"column:sample_name"`
		FailCount         int    `gorm:"column:fail_count"`
		MainViolationType string `gorm:"column:main_violation_type"`
		DistrictsCSV      string `gorm:"column:districts_csv"`
	}
	models.DBDashboard.Raw(`
		SELECT sample_name,
		       COUNT(*) fail_count,
		       MODE() WITHIN GROUP (ORDER BY violation_type) main_violation_type,
		       STRING_AGG(DISTINCT district, ',') FILTER (WHERE district != '未知') districts_csv
		FROM food_inspection_raw
		GROUP BY sample_name
		ORDER BY fail_count DESC
	`).Scan(&sampleRaw)
	samples := make([]fsSampleOut, 0, len(sampleRaw))
	for _, s := range sampleRaw {
		samples = append(samples, fsSampleOut{
			SampleName:        s.SampleName,
			FailCount:         s.FailCount,
			MainViolationType: s.MainViolationType,
			Districts:         splitNonEmpty(s.DistrictsCSV),
		})
	}

	// === districts (top fail areas, both 雙北) ===
	districts := queryDistricts("city IN ('臺北市','新北市')", 0)
	// === recidivists (≥2 fails) ===
	recids := queryRecidivists()

	// === categories (依食品類別聚合，含 risk_score / risk_level / involved_district_count) ===
	type categoryRow struct {
		Category              string  `gorm:"column:category"               json:"category"`
		FailCount             int     `gorm:"column:fail_count"             json:"fail_count"`
		MainViolationType     string  `gorm:"column:main_violation_type"    json:"main_violation_type"`
		InvolvedDistrictCount int     `gorm:"column:involved_district_count" json:"involved_district_count"`
		RiskScore             float64 `gorm:"-"                              json:"risk_score"`
		RiskLevel             string  `gorm:"-"                              json:"risk_level"`
	}
	var categories []categoryRow
	models.DBDashboard.Raw(`
		SELECT COALESCE(category, '其他') category,
		       COUNT(*) fail_count,
		       MODE() WITHIN GROUP (ORDER BY violation_type) main_violation_type,
		       COUNT(DISTINCT district) FILTER (WHERE district != '未知') involved_district_count
		FROM food_inspection_raw
		GROUP BY category
		ORDER BY fail_count DESC
	`).Scan(&categories)
	// 算 risk_score：fail_count 占最大值的比例 → 0~100；level 用門檻分檔
	maxCatFail := 1
	for _, c := range categories {
		if c.FailCount > maxCatFail {
			maxCatFail = c.FailCount
		}
	}
	for i := range categories {
		s := float64(categories[i].FailCount) / float64(maxCatFail) * 100
		categories[i].RiskScore = roundTo(s, 2)
		switch {
		case s >= 80:
			categories[i].RiskLevel = "red"
		case s >= 65:
			categories[i].RiskLevel = "orange"
		case s >= 45:
			categories[i].RiskLevel = "yellow"
		default:
			categories[i].RiskLevel = "green"
		}
	}

	// === monthly_trend (依月份分組，雙北雙線) ===
	type trendRow struct {
		Month string `gorm:"column:m"`
		City  string `gorm:"column:city"`
		Cnt   int    `gorm:"column:cnt"`
	}
	var trendRows []trendRow
	models.DBDashboard.Raw(`
		SELECT TO_CHAR(test_date, 'YYYY-MM') m, city, COUNT(*) cnt
		FROM food_inspection_raw
		WHERE test_date IS NOT NULL AND city IN ('臺北市','新北市')
		GROUP BY m, city
		ORDER BY m
	`).Scan(&trendRows)
	monthSet := map[string]struct{}{}
	for _, t := range trendRows {
		monthSet[t.Month] = struct{}{}
	}
	months := make([]string, 0, len(monthSet))
	for m := range monthSet {
		months = append(months, m)
	}
	// PG 已 ORDER BY m 但 map 會打亂，重排
	for i := 0; i < len(months); i++ {
		for j := i + 1; j < len(months); j++ {
			if months[j] < months[i] {
				months[i], months[j] = months[j], months[i]
			}
		}
	}
	tpeData := make([]int, len(months))
	ntcData := make([]int, len(months))
	monthIdx := map[string]int{}
	for i, m := range months {
		monthIdx[m] = i
	}
	for _, t := range trendRows {
		idx := monthIdx[t.Month]
		if t.City == "臺北市" {
			tpeData[idx] = t.Cnt
		} else if t.City == "新北市" {
			ntcData[idx] = t.Cnt
		}
	}
	monthlyTrend := gin.H{
		"months": months,
		"series": []gin.H{
			{"name": "臺北市", "data": tpeData},
			{"name": "新北市", "data": ntcData},
		},
	}

	// === suggested_inspections (累犯店家 + 高風險食材店家整合，給稽查派工 chart 用) ===
	type sgRow struct {
		StoreName         string  `gorm:"column:store_name"`
		Address           string  `gorm:"column:address"`
		City              string  `gorm:"column:city"`
		DistrictsCSV      string  `gorm:"column:districts_csv"`
		MainViolationType string  `gorm:"column:main_violation_type"`
		FailCount         int     `gorm:"column:fail_count"`
		Severity          float64 `gorm:"column:severity"`
	}
	var sgRows []sgRow
	models.DBDashboard.Raw(`
		SELECT store_name,
		       MAX(address) address,
		       (ARRAY_AGG(DISTINCT city))[1] city,
		       STRING_AGG(DISTINCT district, ',') FILTER (WHERE district != '未知') districts_csv,
		       MODE() WITHIN GROUP (ORDER BY violation_type) main_violation_type,
		       COUNT(*) fail_count,
		       AVG(violation_severity) severity
		FROM food_inspection_raw
		WHERE store_name IS NOT NULL AND store_name != ''
		GROUP BY store_name
		ORDER BY fail_count DESC, severity DESC
		LIMIT 30
	`).Scan(&sgRows)
	suggested := make([]gin.H, 0, len(sgRows))
	maxSgFail := 1
	for _, s := range sgRows {
		if s.FailCount > maxSgFail {
			maxSgFail = s.FailCount
		}
	}
	for i, s := range sgRows {
		actionType := "高風險食材"
		if s.FailCount >= 2 {
			actionType = "累犯店家"
		}
		// action_score = (fail_count 占比 * 0.6) + (severity 標準化 * 0.4)
		freqScore := float64(s.FailCount) / float64(maxSgFail) * 100
		sevScore := s.Severity
		if sevScore > 100 {
			sevScore = 100
		}
		actionScore := freqScore*0.6 + sevScore*0.4
		suggested = append(suggested, gin.H{
			"rank":                i + 1,
			"store_name":          s.StoreName,
			"address":             s.Address,
			"city":                s.City,
			"districts":           splitNonEmpty(s.DistrictsCSV),
			"main_violation_type": s.MainViolationType,
			"fail_count":          s.FailCount,
			"action_type":         actionType,
			"action_score":        roundTo(actionScore, 2),
		})
	}

	// === violations (最近 N 筆，給「近期違規」tab 用) ===
	type violationRow struct {
		SampleName    string  `gorm:"column:sample_name"     json:"sample_name"`
		StoreName     string  `gorm:"column:store_name"      json:"store_name"`
		City          string  `gorm:"column:city"            json:"city"`
		District      string  `gorm:"column:district"        json:"district"`
		TestDate      *string `gorm:"column:test_date"       json:"test_date"`
		ViolationType string  `gorm:"column:violation_type"  json:"violation_type"`
		ReasonSummary string  `gorm:"column:reason_summary"  json:"reason_summary"`
	}
	var violations []violationRow
	models.DBDashboard.Raw(`
		SELECT sample_name, store_name, city, district,
		       test_date::text test_date, violation_type, reason_summary
		FROM food_inspection_raw
		WHERE test_date IS NOT NULL
		ORDER BY test_date DESC
		LIMIT 60
	`).Scan(&violations)

	// === cities sub-aggregation（FE 多個組件依賴 cities[city].{samples,districts,summary}）===
	cities := map[string]gin.H{
		"taipei": {
			"districts": queryDistricts("city = '臺北市'", 0),
			"samples":   queryCitySamples("city = '臺北市'"),
			"summary":   queryCitySummary("city = '臺北市'"),
		},
		"newtaipei": {
			"districts": queryDistricts("city = '新北市'", 0),
			"samples":   queryCitySamples("city = '新北市'"),
			"summary":   queryCitySummary("city = '新北市'"),
		},
		"metrotaipei": {
			"districts": districts,
			"samples":   queryCitySamples("city IN ('臺北市','新北市')"),
			"summary":   queryCitySummary("city IN ('臺北市','新北市')"),
		},
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": gin.H{
			"summary":               summary,
			"samples":               samples,
			"categories":            categories,
			"violations":            violations,
			"districts":             districts,
			"recidivists":           recids,
			"cities":                cities,
			"monthly_trend":         monthlyTrend,
			"suggested_inspections": suggested,
			"metadata": gin.H{
				"source":       "postgres-data.food_inspection_raw",
				"note":         "資料即時取自 postgres-data，每次呼叫都重算",
				"data_total":   totalFail,
				"data_real":    srcCounts.Real,
				"data_mock":    srcCounts.Mock,
				"data_period":  strDeref(dateRow.Earliest) + " ~ " + strDeref(dateRow.Latest),
			},
		},
	})
}

func queryDistricts(whereClause string, limit int) []fsDistrictOut {
	q := `
		SELECT city, district,
		       COUNT(*) fail_count,
		       MODE() WITHIN GROUP (ORDER BY violation_type) main_violation_type
		FROM food_inspection_raw
		WHERE district != '未知' AND ` + whereClause + `
		GROUP BY city, district
		ORDER BY fail_count DESC
	`
	if limit > 0 {
		q += " LIMIT ?"
	}
	var raw []struct {
		City              string `gorm:"column:city"`
		District          string `gorm:"column:district"`
		FailCount         int    `gorm:"column:fail_count"`
		MainViolationType string `gorm:"column:main_violation_type"`
	}
	tx := models.DBDashboard.Raw(q)
	if limit > 0 {
		tx = models.DBDashboard.Raw(q, limit)
	}
	tx.Scan(&raw)

	if len(raw) == 0 {
		return []fsDistrictOut{}
	}
	maxCount := raw[0].FailCount
	if maxCount == 0 {
		maxCount = 1
	}
	out := make([]fsDistrictOut, 0, len(raw))
	for _, d := range raw {
		score := float64(d.FailCount) / float64(maxCount) * 100
		level := "green"
		switch {
		case score >= 80:
			level = "red"
		case score >= 65:
			level = "orange"
		case score >= 45:
			level = "yellow"
		}
		out = append(out, fsDistrictOut{
			City:              d.City,
			District:          d.District,
			FailCount:         d.FailCount,
			MainViolationType: d.MainViolationType,
			RiskScore:         roundTo(score, 2),
			RiskLevel:         level,
		})
	}
	return out
}

// queryCitySamples 取得指定城市範圍內的食材 samples（fail_count 排序）
func queryCitySamples(whereClause string) []fsSampleOut {
	var raw []struct {
		SampleName        string `gorm:"column:sample_name"`
		FailCount         int    `gorm:"column:fail_count"`
		MainViolationType string `gorm:"column:main_violation_type"`
		DistrictsCSV      string `gorm:"column:districts_csv"`
	}
	q := `
		SELECT sample_name,
		       COUNT(*) fail_count,
		       MODE() WITHIN GROUP (ORDER BY violation_type) main_violation_type,
		       STRING_AGG(DISTINCT district, ',') FILTER (WHERE district != '未知') districts_csv
		FROM food_inspection_raw
		WHERE ` + whereClause + `
		GROUP BY sample_name
		ORDER BY fail_count DESC
	`
	models.DBDashboard.Raw(q).Scan(&raw)
	out := make([]fsSampleOut, 0, len(raw))
	for _, s := range raw {
		out = append(out, fsSampleOut{
			SampleName:        s.SampleName,
			FailCount:         s.FailCount,
			MainViolationType: s.MainViolationType,
			Districts:         splitNonEmpty(s.DistrictsCSV),
		})
	}
	return out
}

// queryCitySummary 取得指定城市範圍的小型 summary（total + violation_type_breakdown）
func queryCitySummary(whereClause string) gin.H {
	var total int64
	models.DBDashboard.Raw(
		`SELECT COUNT(*) FROM food_inspection_raw WHERE `+whereClause,
	).Row().Scan(&total)

	var rows []struct {
		Vt  string `gorm:"column:vt"`
		Cnt int    `gorm:"column:cnt"`
	}
	models.DBDashboard.Raw(
		`SELECT violation_type vt, COUNT(*) cnt
		 FROM food_inspection_raw WHERE `+whereClause+`
		 GROUP BY violation_type ORDER BY cnt DESC`,
	).Scan(&rows)
	breakdown := map[string]int{}
	for _, r := range rows {
		breakdown[r.Vt] = r.Cnt
	}
	return gin.H{
		"total_fail_count":         total,
		"violation_type_breakdown": breakdown,
	}
}

func queryRecidivists() []fsRecidivistOut {
	var raw []struct {
		StoreName         string `gorm:"column:store_name"`
		FailCount         int    `gorm:"column:fail_count"`
		City              string `gorm:"column:city"`
		MainViolationType string `gorm:"column:main_violation_type"`
		DistrictsCSV      string `gorm:"column:districts_csv"`
		SamplesCSV        string `gorm:"column:samples_csv"`
	}
	models.DBDashboard.Raw(`
		SELECT store_name,
		       COUNT(*) fail_count,
		       (ARRAY_AGG(DISTINCT city))[1] city,
		       MODE() WITHIN GROUP (ORDER BY violation_type) main_violation_type,
		       STRING_AGG(DISTINCT district, ',') FILTER (WHERE district != '未知') districts_csv,
		       STRING_AGG(DISTINCT sample_name, ',') samples_csv
		FROM food_inspection_raw
		WHERE store_name IS NOT NULL AND store_name != ''
		GROUP BY store_name
		HAVING COUNT(*) >= 2
		ORDER BY
		  CASE WHEN BOOL_OR(city IN ('臺北市','新北市')) AND BOOL_OR(district != '未知') THEN 0 ELSE 1 END,
		  COUNT(*) DESC
	`).Scan(&raw)

	out := make([]fsRecidivistOut, 0, len(raw))
	for _, r := range raw {
		samples := splitNonEmpty(r.SamplesCSV)
		if len(samples) > 8 {
			samples = samples[:8]
		}
		out = append(out, fsRecidivistOut{
			StoreName:         r.StoreName,
			FailCount:         r.FailCount,
			City:              r.City,
			MainViolationType: r.MainViolationType,
			Samples:           samples,
			Districts:         splitNonEmpty(r.DistrictsCSV),
		})
	}
	return out
}

// === GET /api/v1/food/exposure — 脆弱場域暴露 ===
//
// 取代 FE 原本讀的 /data/prepared/vulnerable_exposure.json，
// 即時從 postgres-data 的 vulnerable_facility_exposure / district_exposure_summary /
// food_event_current 三張表組合產出。

type expFacility struct {
	FacilityID         string  `gorm:"column:facility_id"          json:"facility_id"`
	FacilityName       string  `gorm:"column:facility_name"        json:"facility_name"`
	FacilityType       string  `gorm:"column:facility_type"        json:"facility_type"`
	City               string  `gorm:"column:city"                 json:"city"`
	District           string  `gorm:"column:district"             json:"district"`
	Address            string  `gorm:"column:address"              json:"address"`
	Lat                float64 `gorm:"column:lat"                  json:"lat"`
	Lng                float64 `gorm:"column:lng"                  json:"lng"`
	RelationType       string  `gorm:"column:relation_type"        json:"relation_type"`
	RelatedIngredient  string  `gorm:"column:related_ingredient"   json:"related_ingredient"`
	RelatedSupplier    string  `gorm:"column:related_supplier"     json:"related_supplier"`
	ExposurePopulation int     `gorm:"column:exposure_population"  json:"exposure_population"`
	ExposureScore      float64 `gorm:"column:exposure_score"       json:"exposure_score"`
	RiskLevel          string  `gorm:"column:risk_level"           json:"risk_level"`
	SuggestedAttention string  `gorm:"column:suggested_attention"  json:"suggested_attention"`
}

type expDistrict struct {
	City                       string  `gorm:"column:city"                          json:"city"`
	District                   string  `gorm:"column:district"                      json:"district"`
	AffectedSchoolCount        int     `gorm:"column:affected_school_count"         json:"affected_school_count"`
	AffectedKindergartenCount  int     `gorm:"column:affected_kindergarten_count"   json:"affected_kindergarten_count"`
	AffectedCareCount          int     `gorm:"column:affected_care_count"           json:"affected_care_count"`
	ElderlyRatio               float64 `gorm:"column:elderly_ratio"                 json:"elderly_ratio"`
	EstimatedExposedPopulation int     `gorm:"column:estimated_exposed_population"  json:"estimated_exposed_population"`
	ExposureScore              float64 `gorm:"column:exposure_score"                json:"exposure_score"`
	RiskLevel                  string  `gorm:"column:risk_level"                    json:"risk_level"`
	MainReason                 string  `gorm:"column:main_reason"                   json:"main_reason"`
}

func GetFoodExposure(c *gin.Context) {
	var facilities []expFacility
	models.DBDashboard.Raw(
		`SELECT facility_id, facility_name, facility_type, city, district, address,
		        COALESCE(lat,0) lat, COALESCE(lng,0) lng,
		        relation_type, related_ingredient, related_supplier,
		        COALESCE(exposure_population,0) exposure_population,
		        COALESCE(exposure_score,0) exposure_score,
		        risk_level, suggested_attention
		 FROM vulnerable_facility_exposure
		 ORDER BY exposure_score DESC NULLS LAST`,
	).Scan(&facilities)

	var districts []expDistrict
	models.DBDashboard.Raw(
		`SELECT city, district,
		        COALESCE(affected_school_count,0) affected_school_count,
		        COALESCE(affected_kindergarten_count,0) affected_kindergarten_count,
		        COALESCE(affected_care_count,0) affected_care_count,
		        COALESCE(elderly_ratio,0) elderly_ratio,
		        COALESCE(estimated_exposed_population,0) estimated_exposed_population,
		        COALESCE(exposure_score,0) exposure_score,
		        risk_level, main_reason
		 FROM district_exposure_summary
		 ORDER BY exposure_score DESC NULLS LAST`,
	).Scan(&districts)

	// summary KPIs
	var summary struct {
		AffectedSchoolCount        int `gorm:"column:school_count"`
		AffectedKindergartenCount  int `gorm:"column:kg_count"`
		AffectedCareCount          int `gorm:"column:care_count"`
		HighExposureDistrictCount  int `gorm:"column:high_exposure_districts"`
		EstimatedExposedPopulation int `gorm:"column:total_exposed"`
	}
	models.DBDashboard.Raw(
		`SELECT
		   COUNT(*) FILTER (WHERE facility_type = 'school')        school_count,
		   COUNT(*) FILTER (WHERE facility_type = 'kindergarten')  kg_count,
		   COUNT(*) FILTER (WHERE facility_type = 'elderly_home')  care_count,
		   (SELECT COUNT(*) FROM district_exposure_summary
		    WHERE risk_level IN ('red','orange'))                  high_exposure_districts,
		   (SELECT COALESCE(SUM(estimated_exposed_population),0)
		    FROM district_exposure_summary)                        total_exposed
		 FROM vulnerable_facility_exposure`,
	).Scan(&summary)

	// active event
	var event struct {
		EventID               string  `gorm:"column:event_id"                json:"event_id"`
		EventType             string  `gorm:"column:event_type"              json:"event_type"`
		EventDate             *string `gorm:"column:event_date"              json:"event_date"`
		SuspectedIngredient   string  `gorm:"column:suspected_ingredient"    json:"suspected_ingredient"`
		SuspectedSupplierID   string  `gorm:"column:suspected_supplier_id"   json:"suspected_supplier_id"`
		SuspectedSupplierName string  `gorm:"column:suspected_supplier_name" json:"suspected_supplier_name"`
		SourceDistricts       string  `gorm:"column:source_districts"        json:"-"`
		RiskType              string  `gorm:"column:risk_type"               json:"risk_type"`
		Probability           float64 `gorm:"column:probability"             json:"probability"`
		Note                  string  `gorm:"column:note"                    json:"note"`
	}
	models.DBDashboard.Raw(
		`SELECT event_id, event_type, event_date::text event_date,
		        suspected_ingredient, suspected_supplier_id, suspected_supplier_name,
		        source_districts, risk_type, COALESCE(probability,0) probability, note
		 FROM food_event_current WHERE is_active = true ORDER BY id DESC LIMIT 1`,
	).Scan(&event)

	srcDistricts := splitNonEmpty(event.SourceDistricts)

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": gin.H{
			"summary": gin.H{
				"affected_school_count":        summary.AffectedSchoolCount,
				"affected_kindergarten_count":  summary.AffectedKindergartenCount,
				"affected_care_count":          summary.AffectedCareCount,
				"high_exposure_district_count": summary.HighExposureDistrictCount,
				"estimated_exposed_population": summary.EstimatedExposedPopulation,
			},
			"facilities": facilities,
			"districts":  districts,
			"event": gin.H{
				"event_id":                event.EventID,
				"event_type":              event.EventType,
				"event_date":              strDeref(event.EventDate),
				"suspected_ingredient":    event.SuspectedIngredient,
				"suspected_supplier_id":   event.SuspectedSupplierID,
				"suspected_supplier_name": event.SuspectedSupplierName,
				"source_districts":        srcDistricts,
				"risk_type":               event.RiskType,
				"probability":             event.Probability,
				"note":                    event.Note,
			},
			"metadata": gin.H{
				"source": "postgres-data: vulnerable_facility_exposure + district_exposure_summary + food_event_current",
			},
		},
	})
}

// === GET /api/v1/food/disease-stats — Component 6 食源性疾病統計 ===
//
// 從 postgres-data.disease_outbreak_stats 取得 7 種主要病原統計，
// 每筆含關聯食材 / 處置策略 / 檢驗方向，回答「從病原反推食材」的決策問題。

type diseaseRow struct {
	Pathogen        string  `gorm:"column:pathogen"          json:"pathogen"`
	PathogenType    string  `gorm:"column:pathogen_type"     json:"pathogen_type"`
	CaseCount       int     `gorm:"column:case_count"        json:"case_count"`
	CaseSharePct    float64 `gorm:"column:case_share_pct"    json:"case_share_pct"`
	SeverityLevel   string  `gorm:"column:severity_level"    json:"severity_level"`
	RelatedFoodsCSV string  `gorm:"column:related_foods"     json:"-"`
	TypicalSettings string  `gorm:"column:typical_settings"  json:"typical_settings"`
	ActionStrategy  string  `gorm:"column:action_strategy"   json:"action_strategy"`
	TestDirection   string  `gorm:"column:test_direction"    json:"test_direction"`
	IncubationHr    string  `gorm:"column:incubation_hr"     json:"incubation_hr"`
	MainSymptom     string  `gorm:"column:main_symptom"      json:"main_symptom"`
	ColorHex        string  `gorm:"column:color_hex"         json:"color_hex"`
	SortOrder       int     `gorm:"column:sort_order"        json:"sort_order"`
	Notes           string  `gorm:"column:notes"             json:"notes"`
}

func GetFoodDiseaseStats(c *gin.Context) {
	var rows []diseaseRow
	models.DBDashboard.Raw(`
		SELECT pathogen, pathogen_type, case_count, case_share_pct, severity_level,
		       related_foods, typical_settings, action_strategy, test_direction,
		       incubation_hr, main_symptom, color_hex, sort_order, notes
		FROM disease_outbreak_stats
		ORDER BY sort_order, case_count DESC
	`).Scan(&rows)

	items := make([]gin.H, 0, len(rows))
	totalCases := 0
	for _, r := range rows {
		totalCases += r.CaseCount
		items = append(items, gin.H{
			"pathogen":         r.Pathogen,
			"pathogen_type":    r.PathogenType,
			"case_count":       r.CaseCount,
			"case_share_pct":   r.CaseSharePct,
			"severity_level":   r.SeverityLevel,
			"related_foods":    splitNonEmpty(r.RelatedFoodsCSV),
			"typical_settings": r.TypicalSettings,
			"action_strategy":  r.ActionStrategy,
			"test_direction":   r.TestDirection,
			"incubation_hr":    r.IncubationHr,
			"main_symptom":     r.MainSymptom,
			"color_hex":        r.ColorHex,
			"sort_order":       r.SortOrder,
			"notes":            r.Notes,
		})
	}

	// 推導 KPI
	highSev := 0
	bacteriaCnt := 0
	virusCnt := 0
	for _, r := range rows {
		if r.SeverityLevel == "high" {
			highSev += r.CaseCount
		}
		if r.PathogenType == "bacteria" {
			bacteriaCnt += r.CaseCount
		}
		if r.PathogenType == "virus" {
			virusCnt += r.CaseCount
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": gin.H{
			"summary": gin.H{
				"total_cases":      totalCases,
				"pathogen_count":   len(rows),
				"high_severity":    highSev,
				"bacteria_cases":   bacteriaCnt,
				"virus_cases":      virusCnt,
			},
			"items": items,
			"metadata": gin.H{
				"source": "衛福部疾管署食品中毒監視系統 (典型雙北年度分布) + postgres-data.disease_outbreak_stats",
				"note":   "資料模型對齊衛福部疾管署歷年公開統計，數值為雙北年度典型分布",
			},
		},
	})
}

func splitNonEmpty(s string) []string {
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

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func roundTo(f float64, digits int) float64 {
	pow := 1.0
	for i := 0; i < digits; i++ {
		pow *= 10
	}
	return float64(int(f*pow+0.5)) / pow
}
