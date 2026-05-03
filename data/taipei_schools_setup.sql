-- 補上臺北市公立國中小資料（demo 補強）
-- 1. 加入 school_directory（30 家臺北市國中小）
-- 2. 從這 30 家挑 10 家做 力銘農產 / 高麗菜 事件 的暴露對象
-- 3. 更新 district_exposure_summary 把學校影響也加進臺北市行政區

BEGIN;

-- === Step 1: school_directory ===
DELETE FROM public.school_directory WHERE agency_code LIKE '3_______T';

COPY public.school_directory
  (agency_code, school_name, area_code, district, primary_zone, free_zone, note)
FROM '/tmp/taipei_schools.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- 把剛灌進來那 30 筆 city 補成 '臺北市'
UPDATE public.school_directory SET city = '臺北市'
 WHERE agency_code LIKE '3_______T' AND city IS NULL;

-- === Step 2: vulnerable_facility_exposure（10 家做事件暴露對象）===
DELETE FROM public.vulnerable_facility_exposure WHERE facility_id LIKE 'TPE-SCH-%';

INSERT INTO public.vulnerable_facility_exposure
  (facility_id, facility_name, facility_type, city, district, address,
   lat, lng, relation_type, related_ingredient, related_supplier,
   exposure_population, exposure_score, risk_level, suggested_attention)
VALUES
  -- 力銘農產 同食材直接供應（red / orange）
  ('TPE-SCH-301020200T', '螢橋國小', 'school',
   '臺北市', '中正區', '汀州路二段23號',
   25.0260, 121.5108, '同供應商高麗菜配送', '高麗菜', '力銘農產',
   850, 82.0, 'orange',
   '建議中正區衛生所配合教育局立即抽驗該校近三日午餐留樣與冷藏高麗菜。'),
  ('TPE-SCH-303010100T', '中山國小', 'school',
   '臺北市', '中山區', '長安東路一段1號',
   25.0517, 121.5224, '同供應商高麗菜配送', '高麗菜', '力銘農產',
   1200, 85.0, 'orange',
   '規模大、學童人數多，建議併同民權國小、中山國中聯合稽查。'),
  ('TPE-SCH-305010100T', '龍門國小', 'school',
   '臺北市', '大安區', '建國南路二段250號',
   25.0282, 121.5424, '同供應商高麗菜配送', '高麗菜', '力銘農產',
   780, 78.0, 'orange',
   '建議大安區先行抽驗午餐並通知家長。'),
  ('TPE-SCH-306010100T', '老松國小', 'school',
   '臺北市', '萬華區', '桂林路64號',
   25.0354, 121.5031, '同供應商高麗菜配送', '高麗菜', '力銘農產',
   620, 75.0, 'orange',
   '建議萬華區衛生所優先稽查。'),
  ('TPE-SCH-307010100T', '永春國小', 'school',
   '臺北市', '信義區', '松山路656號',
   25.0395, 121.5689, '同源供應鏈關聯', '高麗菜', '力銘農產',
   720, 70.0, 'yellow',
   '請信義區衛生所複核近期食材進貨單，確認是否經由力銘或下游中盤商。'),

  -- 同食材其他學校（潛在風險，yellow）
  ('TPE-SCH-308010100T', '士林國小', 'school',
   '臺北市', '士林區', '大東路165號',
   25.0900, 121.5267, '同食材其他學校（潛在風險）', '高麗菜', '力銘農產',
   880, 65.0, 'yellow',
   '建議列為次要稽查，三日內回報。'),
  ('TPE-SCH-310010100T', '麗山國小', 'school',
   '臺北市', '內湖區', '麗山街462巷10號',
   25.0816, 121.5810, '同食材其他學校（潛在風險）', '高麗菜', '力銘農產',
   720, 62.0, 'yellow',
   '與內湖區受影響幼兒園併案處理。'),
  ('TPE-SCH-312010100T', '木柵國小', 'school',
   '臺北市', '文山區', '木柵路三段102巷12號',
   24.9880, 121.5712, '同食材其他學校（潛在風險）', '高麗菜', '力銘農產',
   650, 58.0, 'yellow',
   '建議列為次要稽查。'),
  ('TPE-SCH-309010100T', '北投國小', 'school',
   '臺北市', '北投區', '中央南路一段76號',
   25.1361, 121.5066, '同食材其他學校（潛在風險）', '高麗菜', '力銘農產',
   580, 55.0, 'yellow',
   '與祥和老人長照中心同行政區，建議併案。'),
  ('TPE-SCH-311010100T', '南港國小', 'school',
   '臺北市', '南港區', '昆陽街179號',
   25.0533, 121.6066, '同食材其他學校（潛在風險）', '高麗菜', '力銘農產',
   540, 52.0, 'yellow',
   '建議列為次要稽查。');

-- === Step 3: district_exposure_summary 新增/更新臺北行政區 ===
-- 中正、中山、信義、北投、內湖、士林：併入新增的學校影響數
-- 大安：原本只有 1 幼兒園 + 1 長照(榮民之家) → 加上龍門國小
-- 大同 / 松山 / 萬華 / 文山 / 南港：新行政區，INSERT

DELETE FROM public.district_exposure_summary
 WHERE city = '臺北市' AND district IN ('中正區','中山區','信義區','北投區','內湖區',
                                         '士林區','大安區','萬華區','文山區','南港區');

INSERT INTO public.district_exposure_summary
  (city, district, affected_school_count, affected_kindergarten_count, affected_care_count,
   elderly_ratio, estimated_exposed_population, exposure_score, risk_level, main_reason)
VALUES
  -- 中正區: 螢橋國小 + 原本中正區幼兒園 2 所
  ('臺北市','中正區', 1, 2, 0, 0.165,  850 + 4596,  82.0, 'orange',
   '螢橋國小 1 所 + 幼兒園 2 所共約 5,446 名學童暴露'),
  -- 中山區: 中山國小 + 崇仁長照
  ('臺北市','中山區', 1, 0, 1, 0.165, 1200 + 65,   85.0, 'red',
   '中山國小 1 所(1,200 童) + 崇仁長照 1 處(65 長者)'),
  -- 大安區: 龍門國小 + 原大安區幼兒園 1 + 榮民之家
  ('臺北市','大安區', 1, 1, 1, 0.180,  780 + 8021 + 280, 88.0, 'red',
   '龍門國小、幼兒園 1 所、榮民之家(280 長者) 共暴露'),
  -- 萬華區: 老松國小（新行政區）
  ('臺北市','萬華區', 1, 0, 0, 0.175,  620,        75.0, 'orange',
   '老松國小 1 所 620 名學童暴露'),
  -- 信義區: 永春國小 + 廣慈博愛院 + 信義老人安養
  ('臺北市','信義區', 1, 0, 2, 0.187,  720 + 208,  78.0, 'orange',
   '永春國小 1 所 + 長照 2 處 共暴露'),
  -- 士林區: 士林國小 + 原士林區幼兒園 2
  ('臺北市','士林區', 1, 2, 0, 0.158,  880 + 4269, 72.0, 'orange',
   '士林國小 1 所 + 幼兒園 2 所共約 5,149 名學童暴露'),
  -- 北投區: 北投國小 + 北投祥和長照
  ('臺北市','北投區', 1, 0, 1, 0.191,  580 + 70,   62.0, 'yellow',
   '北投國小 1 所 + 祥和長照 1 處共暴露'),
  -- 內湖區: 麗山國小 + 原內湖區幼兒園 2
  ('臺北市','內湖區', 1, 2, 0, 0.155,  720 + 7814, 70.0, 'yellow',
   '麗山國小 1 所 + 幼兒園 2 所共約 8,534 名學童暴露'),
  -- 文山區: 木柵國小（新）
  ('臺北市','文山區', 1, 0, 0, 0.162,  650,        58.0, 'yellow',
   '木柵國小 1 所 650 名學童暴露'),
  -- 南港區: 南港國小（新）
  ('臺北市','南港區', 1, 0, 0, 0.190,  540,        52.0, 'yellow',
   '南港國小 1 所 540 名學童暴露');

-- === 驗證 ===
SELECT facility_type, city, COUNT(*) AS n
  FROM public.vulnerable_facility_exposure
 GROUP BY facility_type, city ORDER BY city, facility_type;

SELECT city, COUNT(*) AS districts,
       SUM(affected_school_count)        AS schools,
       SUM(affected_kindergarten_count)  AS kg,
       SUM(affected_care_count)          AS care,
       SUM(estimated_exposed_population) AS total_pop
  FROM public.district_exposure_summary
 GROUP BY city ORDER BY city;

COMMIT;
