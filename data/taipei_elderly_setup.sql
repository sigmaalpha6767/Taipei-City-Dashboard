-- 補上臺北市老人福利機構資料（demo 補強）
-- 1. 加入 care_facility_directory（15 家）
-- 2. 從這 15 家挑 5 家做 力銘農產 / 高麗菜 事件 的暴露對象，寫入 vulnerable_facility_exposure
-- 3. 加 4 個臺北市行政區到 district_exposure_summary（中正/中山/北投/信義 各 1）

BEGIN;

-- === Step 1: care_facility_directory ===
DELETE FROM public.care_facility_directory WHERE seqno LIKE 'T%';

COPY public.care_facility_directory
  (seqno, facility_name, city, district, address, person_in_charge, phone,
   bed_caring, bed_nursing, bed_longterm, bed_azh)
FROM '/tmp/taipei_elderly.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- === Step 2: vulnerable_facility_exposure（5 家做事件暴露對象）===
DELETE FROM public.vulnerable_facility_exposure WHERE facility_id LIKE 'TPE-CARE-%';

INSERT INTO public.vulnerable_facility_exposure
  (facility_id, facility_name, facility_type, city, district, address,
   lat, lng, relation_type, related_ingredient, related_supplier,
   exposure_population, exposure_score, risk_level, suggested_attention)
VALUES
  ('TPE-CARE-T01', '財團法人臺北市私立廣慈博愛院', 'elderly_home',
   '臺北市', '信義區', '福德街200號',
   25.0303, 121.5717, '同供應商高麗菜配送', '高麗菜', '力銘農產',
   120, 78.0, 'orange',
   '建議信義區衛生所立即抽驗該院近三日餐食留樣與冷藏高麗菜，並於 24 小時內回報結果。'),
  ('TPE-CARE-T05', '國軍臺北榮譽國民之家', 'elderly_home',
   '臺北市', '大安區', '辛亥路三段123號',
   25.0259, 121.5435, '同供應商高麗菜配送', '高麗菜', '力銘農產',
   280, 82.0, 'orange',
   '高齡長者人數多、共膳風險高，建議優先稽查並暫停可疑批次出餐。'),
  ('TPE-CARE-T07', '臺北市私立崇仁老人長期照顧中心', 'elderly_home',
   '臺北市', '中山區', '新生北路三段80巷8號',
   25.0596, 121.5305, '同源供應鏈關聯', '高麗菜', '力銘農產',
   65, 65.0, 'yellow',
   '請中山區衛生所複核近期食材進貨單，確認是否經由力銘或下游中盤商。'),
  ('TPE-CARE-T13', '臺北市私立信義老人安養中心', 'elderly_home',
   '臺北市', '信義區', '松德路85巷10號',
   25.0303, 121.5717, '同源供應鏈關聯', '高麗菜', '力銘農產',
   88, 70.0, 'yellow',
   '與廣慈博愛院同行政區，建議併案稽查與檢驗。'),
  ('TPE-CARE-T14', '臺北市私立北投祥和老人長期照顧中心', 'elderly_home',
   '臺北市', '北投區', '中央北路二段150號',
   25.1322, 121.5018, '同食材其他長照（潛在風險）', '高麗菜', '力銘農產',
   70, 58.0, 'yellow',
   '與板橋區事件源相距較遠，建議列為次要稽查目標，三日內回報。');

-- === Step 3: district_exposure_summary 加 4 個臺北市行政區的長照影響 ===
-- 已存在 4 筆臺北市（中正/內湖/士林/大安）只有幼兒園資料 → 增量更新 affected_care_count
UPDATE public.district_exposure_summary SET
  affected_care_count = 1,
  estimated_exposed_population = COALESCE(estimated_exposed_population, 0) + 280,
  exposure_score = GREATEST(COALESCE(exposure_score, 0), 82.0),
  risk_level = 'orange',
  main_reason = COALESCE(main_reason, '') ||
                CASE WHEN main_reason IS NOT NULL THEN '；' ELSE '' END ||
                '長照機構 1 處（榮民之家）暴露'
 WHERE city = '臺北市' AND district = '大安區';

-- 信義區、中山區、北投區：原本沒在 district_exposure_summary 出現 → INSERT
DELETE FROM public.district_exposure_summary
 WHERE city = '臺北市' AND district IN ('信義區','中山區','北投區');

INSERT INTO public.district_exposure_summary
  (city, district, affected_school_count, affected_kindergarten_count, affected_care_count,
   elderly_ratio, estimated_exposed_population, exposure_score, risk_level, main_reason)
VALUES
  ('臺北市','信義區', 0, 0, 2, 0.187, 208, 78.0, 'orange',
   '長照機構 2 處（廣慈博愛院、信義老人安養中心）共 208 名長者暴露'),
  ('臺北市','中山區', 0, 0, 1, 0.165, 65,  65.0, 'yellow',
   '長照機構 1 處（崇仁老人長期照顧中心）65 名長者暴露'),
  ('臺北市','北投區', 0, 0, 1, 0.191, 70,  58.0, 'yellow',
   '長照機構 1 處（祥和老人長期照顧中心）70 名長者暴露');

-- === 驗證 ===
SELECT 'vulnerable_facility_exposure' AS tbl, facility_type, city, COUNT(*) cnt
  FROM public.vulnerable_facility_exposure
 GROUP BY facility_type, city ORDER BY city, facility_type;

SELECT 'district_exposure_summary' AS tbl, city, COUNT(*) cnt,
       SUM(affected_care_count) total_care
  FROM public.district_exposure_summary
 GROUP BY city ORDER BY city;

COMMIT;
