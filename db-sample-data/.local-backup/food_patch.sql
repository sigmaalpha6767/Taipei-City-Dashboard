-- Food-safety patch: adds components 220-224 + related charts/maps/query_charts
-- Generated from db-sample-data/dashboardmanager-demo.sql
BEGIN;

DELETE FROM public.query_charts WHERE index IN (
  'food_safety_care_exposure', 'food_safety_citizen_radar', 'food_safety_disease_stats', 'food_safety_risk_inspection', 'food_safety_vulnerable_exposure'
);
DELETE FROM public.component_charts WHERE index IN (
  'food_safety_care_exposure', 'food_safety_citizen_radar', 'food_safety_disease_stats', 'food_safety_risk_inspection', 'food_safety_vulnerable_exposure'
);
DELETE FROM public.component_maps WHERE id IN (200,201,202,210,211);
DELETE FROM public.components   WHERE id IN (220,221,222,223,224);

COPY public.component_charts (index, color, types, unit) FROM stdin;
food_safety_vulnerable_exposure	{#5a9cf8,#888787}	{FoodSafetySchoolExposure}	\N
food_safety_care_exposure	{#5a9cf8,#888787}	{FoodSafetyCareExposure}	\N
food_safety_risk_inspection	{#E0413A,#F08740,#F2C94C,#56B96D,#7B1FA2,#1E88E5}	{FoodSafetyCategoryChart,FoodSafetyDistrictChart}	\N
food_safety_citizen_radar	{#56C1F0,#F5AD4A,#E0413A,#56B96D}	{FoodSafetyCitizenRadar}	\N
food_safety_disease_stats	{#5a9cf8,#888787}	{FoodSafetyDiseaseStats}	\N
\.

COPY public.component_maps (id, index, title, type, source, size, icon, paint, property) FROM stdin;
200	vulnerable_facility_school	受影響學校	circle	geojson	\N	\N	{"circle-radius":6,"circle-color":["match",["get","risk_level"],"red","#E0413A","orange","#F08740","yellow","#F2C94C","#56B96D"],"circle-stroke-width":1.5,"circle-stroke-color":"#ffffff"}	[{"key":"facility_name","name":"學校名稱"},{"key":"district","name":"行政區"},{"key":"relation_type","name":"關聯原因"},{"key":"related_ingredient","name":"疑似原料"},{"key":"related_supplier","name":"疑似供應商"},{"key":"exposure_score","name":"暴露分數"},{"key":"suggested_attention","name":"建議關注"}]
201	vulnerable_facility_kindergarten	受影響幼兒園	circle	geojson	\N	\N	{"circle-radius":5,"circle-color":["match",["get","risk_level"],"red","#E0413A","orange","#F08740","yellow","#F2C94C","#56B96D"],"circle-stroke-width":1.5,"circle-stroke-color":"#ffffff"}	[{"key":"facility_name","name":"幼兒園名稱"},{"key":"district","name":"行政區"},{"key":"relation_type","name":"關聯原因"},{"key":"related_ingredient","name":"疑似原料"},{"key":"related_supplier","name":"疑似供應商"},{"key":"exposure_score","name":"暴露分數"},{"key":"suggested_attention","name":"建議關注"}]
202	vulnerable_facility_care	受影響長照機構	circle	geojson	\N	\N	{"circle-radius":7,"circle-color":["match",["get","risk_level"],"red","#E0413A","orange","#F08740","yellow","#F2C94C","#56B96D"],"circle-stroke-width":1.5,"circle-stroke-color":"#ffffff"}	[{"key":"facility_name","name":"機構名稱"},{"key":"facility_type","name":"類型"},{"key":"district","name":"行政區"},{"key":"relation_type","name":"關聯原因"},{"key":"related_ingredient","name":"疑似原料"},{"key":"related_supplier","name":"疑似供應商"},{"key":"exposure_score","name":"暴露分數"},{"key":"suggested_attention","name":"建議關注"}]
210	inspection_failure_point	抽驗不合格地點	circle	geojson	\N	\N	{"circle-color": ["match", ["get", "violation_type"], "重金屬", "#7B1FA2", "農藥殘留", "#E0413A", "微生物", "#F08740", "動物用藥", "#FF7043", "防腐劑與添加物", "#FFB300", "標示不符", "#1E88E5", "#56B96D"], "circle-radius": 5, "circle-opacity": 0.8, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2}	[{"key": "store_name", "name": "抽驗地點"}, {"key": "sample_name", "name": "檢體名稱"}, {"key": "category", "name": "分類"}, {"key": "district", "name": "行政區"}, {"key": "violation_type", "name": "違規類別"}, {"key": "reason_summary", "name": "不符合原因"}, {"key": "test_date", "name": "抽驗日期"}]
211	radar_warning	高風險店家雷達警示	fill	geojson	\N	\N	{"fill-color": ["match", ["get", "tier"], 1, "#E0413A", 2, "#F2C94C", 3, "#F08740", "#cccccc"], "fill-opacity": ["match", ["get", "tier"], 1, 0.10, 2, 0.18, 3, 0.32, 0.1], "fill-outline-color": "#ffffff"}	[{"key": "store_name", "name": "高風險店家"}, {"key": "city", "name": "城市"}, {"key": "district", "name": "行政區"}, {"key": "fail_count", "name": "歷史違規"}, {"key": "main_violation_type", "name": "主要違規"}, {"key": "tier_label", "name": "警示等級"}, {"key": "radius_m", "name": "範圍(公尺)"}]
\.

COPY public.components (id, index, name) FROM stdin;
220	food_safety_vulnerable_exposure	校園食安暴露風險
221	food_safety_risk_inspection	食品抽驗不合格與高風險食材
222	food_safety_citizen_radar	市民食安雷達
223	food_safety_care_exposure	長照食安暴露風險
224	food_safety_disease_stats	食源性疾病統計
\.

COPY public.query_charts (index, history_config, map_config_ids, map_filter, time_from, time_to, update_freq, update_freq_unit, source, short_desc, long_desc, use_case, links, contributors, created_at, updated_at, query_type, query_chart, query_history, city) FROM stdin;
food_safety_vulnerable_exposure	\N	{200,201}	{"mode": "byLayer"}	static	\N	\N	\N	教育部、雙北教育局、衛生局	當前食安事件對校園（國中小+幼兒園）之暴露範圍。	依據當前食安事件、疑似原物料或同源供應商風險，篩選受影響的國中小與幼兒園，並呈現各行政區暴露分數。資料來自 postgres-data 的 vulnerable_facility_exposure / district_exposure_summary / food_event_current 三張表，BE 端點為 GET /api/v1/food/exposure。	衛生局判定影響範圍、教育局通知學校檢查午餐留樣、AI 決策建議生成校方公告函。	{}	{doit}	2026-05-02 00:00:00+00	2026-05-02 00:00:00+00	two_d	SELECT '事件模式' AS x_axis, 1 AS data	\N	metrotaipei
food_safety_care_exposure	\N	{202}	{"mode": "byLayer"}	static	\N	\N	\N	社會局、衛生局	當前食安事件對長照機構之暴露範圍。	依據當前食安事件、疑似原物料或同源供應商風險，篩選受影響的長照機構並呈現各行政區暴露分數。資料來自 postgres-data 的 vulnerable_facility_exposure / district_exposure_summary / food_event_current 三張表，BE 端點為 GET /api/v1/food/exposure。	社會局通知長照機構檢查餐食來源、衛生局判定影響範圍、AI 決策建議生成提醒函。	{}	{doit}	2026-05-02 00:00:00+00	2026-05-02 00:00:00+00	two_d	SELECT '事件模式' AS x_axis, 1 AS data	\N	metrotaipei
food_safety_risk_inspection	\N	{210,211}	{"mode": "byParam", "byParam": {"xParam": "district"}}	static	\N	1	year	臺北市政府衛生局	臺北市 113 年食品抽驗不合格清冊分析，找出高風險食材類別與行政區。	本組件以臺北市衛生局公開的食品抽驗不合格清冊為基礎，計算各食材類別的不合格件數、主要違規原因（農藥殘留／微生物／重金屬／添加物等）與涉及行政區。資料涵蓋 268 筆不合格抽驗紀錄。	為衛生局後續加強抽驗的優先順序提供依據；為教育局／社會局判斷食材採購風險提供背景資料；為市民查詢生活區域食安風險提供透明度。	{https://data.taipei/dataset/detail?id=02b3f7a1-fca9-4eb9-b0f8-cc54da35ddee}	{doit}	2026-05-02 00:00:00+00	2026-05-02 00:00:00+00	two_d	SELECT '全年彙整' AS x_axis, 268 AS data	\N	metrotaipei
food_safety_risk_inspection	\N	{210,211}	{"mode": "byParam", "byParam": {"xParam": "district"}}	static	\N	1	year	臺北市政府衛生局	臺北市 113 年食品抽驗不合格清冊分析，找出高風險食材類別與行政區。	本組件以臺北市衛生局公開的食品抽驗不合格清冊為基礎，計算各食材類別的不合格件數、主要違規原因（農藥殘留／微生物／重金屬／添加物等）與涉及行政區。資料涵蓋 268 筆不合格抽驗紀錄。	為衛生局後續加強抽驗的優先順序提供依據；為教育局／社會局判斷食材採購風險提供背景資料；為市民查詢生活區域食安風險提供透明度。	{https://data.taipei/dataset/detail?id=02b3f7a1-fca9-4eb9-b0f8-cc54da35ddee}	{doit}	2026-05-02 00:00:00+00	2026-05-02 00:00:00+00	two_d	SELECT '全年彙整' AS x_axis, 268 AS data	\N	taipei
food_safety_citizen_radar	\N	{210}	{"mode": "byParam", "byParam": {"xParam": "sample_name"}}	static	\N	\N	\N	雙北衛生局、教育局、社會局	輸入您的住址或所在位置，立即取得方圓 1 公里內食安風險評估與行動建議。	市民食安雷達整合 Component 1（食品抽驗不合格清冊）+ Component 4（校園長照暴露分析）的資料，依使用者所在位置即時計算個人化風險分數，列出範圍內的不合格店家、學校、長照機構，並給出避開或聯繫機構的具體建議。	家長確認小孩學校用餐風險、子女查詢長輩活動範圍食安狀況、市民選擇外食地點前的風險檢查、衛生局與民眾雙向的食安透明度。	{}	{doit}	2026-05-02 00:00:00+00	2026-05-02 00:00:00+00	two_d	SELECT '市民查詢' AS x_axis, 1 AS data	\N	metrotaipei
food_safety_citizen_radar	\N	{210}	{"mode": "byParam", "byParam": {"xParam": "sample_name"}}	static	\N	\N	\N	雙北衛生局、教育局、社會局	輸入您的住址或所在位置，立即取得方圓 1 公里內食安風險評估與行動建議。	市民食安雷達整合 Component 1（食品抽驗不合格清冊）+ Component 4（校園長照暴露分析）的資料，依使用者所在位置即時計算個人化風險分數，列出範圍內的不合格店家、學校、長照機構，並給出避開或聯繫機構的具體建議。	家長確認小孩學校用餐風險、子女查詢長輩活動範圍食安狀況、市民選擇外食地點前的風險檢查、衛生局與民眾雙向的食安透明度。	{}	{doit}	2026-05-02 00:00:00+00	2026-05-02 00:00:00+00	two_d	SELECT '市民查詢' AS x_axis, 1 AS data	\N	taipei
food_safety_disease_stats	\N	\N	\N	static	\N	\N	\N	衛福部疾管署、雙北衛生局	從病原統計反推可能食材與處置策略。	依雙北年度食品中毒典型分布（諾羅 / 沙門氏菌 / 腸炎弧菌等 7 種主要病原），呈現件數佔比、嚴重度，並對每個病原顯示關聯食材、典型發生場所、處置策略與檢驗方向。資料表 disease_outbreak_stats，BE 端點 GET /api/v1/food/disease-stats。	衛生局接獲群聚通報時快速判斷可能食材方向；學校 / 長照機構環境消毒決策；AI 提示稽查與檢驗優先級。	{}	{doit}	2026-05-02 00:00:00+00	2026-05-02 00:00:00+00	two_d	SELECT 'disease' AS x_axis, 1 AS data	\N	metrotaipei
\.

-- Re-link dashboard 358 (practical_transportation_newtpe) to include 220, 223
UPDATE public.dashboards SET components = '{60,212,213,220,223}' WHERE id = 358;

SELECT setval(pg_get_serial_sequence('public.components', 'id'),
              GREATEST(COALESCE(MAX(id),0), 224)) FROM public.components;
SELECT setval(pg_get_serial_sequence('public.component_maps', 'id'),
              GREATEST(COALESCE(MAX(id),0), 211)) FROM public.component_maps;

COMMIT;
