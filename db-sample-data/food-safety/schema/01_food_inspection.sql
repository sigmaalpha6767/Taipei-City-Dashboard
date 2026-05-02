-- 食安抽驗 raw 表 — 取代 FE 靜態 food_inspection.json
-- 對齊「資料端→BE→FE」標準路徑：raw 表存於 postgres-data，BE 用 SQL 聚合給 tool/chart

CREATE TABLE IF NOT EXISTS food_inspection_raw (
    id              BIGSERIAL PRIMARY KEY,
    violation_id    VARCHAR(20) UNIQUE NOT NULL,
    source          VARCHAR(40),         -- 113年臺北市 / mock
    project         VARCHAR(200),
    category        VARCHAR(50),
    sample_name     VARCHAR(200),
    city            VARCHAR(20),         -- 臺北市 / 新北市 / 其他
    district        VARCHAR(20),         -- 信義區 / 板橋區 / 未知
    store_name      VARCHAR(200),
    address         TEXT,
    test_date       DATE,
    violation_type  VARCHAR(40),         -- 重金屬/農藥殘留/微生物/動物用藥/防腐劑與添加物/標示不符/其他
    violation_severity INTEGER,
    reason_summary  VARCHAR(300),
    reason_full     TEXT,
    lat             DOUBLE PRECISION,
    lng             DOUBLE PRECISION,
    is_mock         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fi_city          ON food_inspection_raw (city);
CREATE INDEX IF NOT EXISTS idx_fi_district      ON food_inspection_raw (city, district);
CREATE INDEX IF NOT EXISTS idx_fi_violation     ON food_inspection_raw (violation_type);
CREATE INDEX IF NOT EXISTS idx_fi_test_date     ON food_inspection_raw (test_date);
CREATE INDEX IF NOT EXISTS idx_fi_sample        ON food_inspection_raw (sample_name);
CREATE INDEX IF NOT EXISTS idx_fi_store         ON food_inspection_raw (store_name);
