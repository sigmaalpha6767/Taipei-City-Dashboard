-- 脆弱場域暴露相關表 — 對齊資料端→BE→FE 標準路徑
--
-- 1. school_directory             校園清冊（新北市公立國小學區，30 筆，原始開放資料）
-- 2. care_facility_directory      長照／老人福利機構（新北市老人福利機構，30 筆，原始開放資料）
-- 3. vulnerable_facility_exposure 受當前食安事件波及的場域（83 筆，含學校+幼兒園+長照，
--                                  已標 lat/lng/risk_level/exposure_population，可直接給地圖渲染）
-- 4. food_event_current           當前活動事件（1 筆，含可疑供應商/食材/事件機率）
-- 5. district_exposure_summary    各行政區暴露摘要（17 筆，給 Section 3 KPI）

CREATE TABLE IF NOT EXISTS school_directory (
    id              BIGSERIAL PRIMARY KEY,
    agency_code     VARCHAR(40) UNIQUE,
    school_name     VARCHAR(200),
    area_code       VARCHAR(40),
    city            VARCHAR(20),
    district        VARCHAR(20),
    primary_zone    TEXT,
    free_zone       TEXT,
    note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_school_district ON school_directory (city, district);

CREATE TABLE IF NOT EXISTS care_facility_directory (
    id              BIGSERIAL PRIMARY KEY,
    seqno           VARCHAR(20),
    facility_name   VARCHAR(200) UNIQUE,
    city            VARCHAR(20),
    district        VARCHAR(20),
    address         TEXT,
    person_in_charge VARCHAR(100),
    phone           VARCHAR(50),
    bed_caring      INTEGER,
    bed_nursing     INTEGER,
    bed_longterm    INTEGER,
    bed_azh         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_care_district ON care_facility_directory (city, district);

CREATE TABLE IF NOT EXISTS vulnerable_facility_exposure (
    id                    BIGSERIAL PRIMARY KEY,
    facility_id           VARCHAR(40) UNIQUE,
    facility_name         VARCHAR(200),
    facility_type         VARCHAR(40),         -- school/kindergarten/elderly_home
    city                  VARCHAR(20),
    district              VARCHAR(20),
    address               TEXT,
    lat                   DOUBLE PRECISION,
    lng                   DOUBLE PRECISION,
    relation_type         VARCHAR(80),
    related_ingredient    VARCHAR(80),
    related_supplier      VARCHAR(200),
    exposure_population   INTEGER,
    exposure_score        DOUBLE PRECISION,
    risk_level            VARCHAR(20),
    suggested_attention   TEXT
);
CREATE INDEX IF NOT EXISTS idx_vfe_district ON vulnerable_facility_exposure (city, district);
CREATE INDEX IF NOT EXISTS idx_vfe_type     ON vulnerable_facility_exposure (facility_type);
CREATE INDEX IF NOT EXISTS idx_vfe_risk     ON vulnerable_facility_exposure (risk_level);

CREATE TABLE IF NOT EXISTS district_exposure_summary (
    id                          BIGSERIAL PRIMARY KEY,
    city                        VARCHAR(20),
    district                    VARCHAR(20),
    affected_school_count       INTEGER,
    affected_kindergarten_count INTEGER,
    affected_care_count         INTEGER,
    elderly_ratio               DOUBLE PRECISION,
    estimated_exposed_population INTEGER,
    exposure_score              DOUBLE PRECISION,
    risk_level                  VARCHAR(20),
    main_reason                 TEXT,
    UNIQUE (city, district)
);

CREATE TABLE IF NOT EXISTS food_event_current (
    id                       BIGSERIAL PRIMARY KEY,
    event_id                 VARCHAR(40) UNIQUE,
    event_type               VARCHAR(40),
    event_date               DATE,
    suspected_ingredient     VARCHAR(100),
    suspected_supplier_id    VARCHAR(40),
    suspected_supplier_name  VARCHAR(200),
    source_districts         TEXT,           -- 逗號分隔
    risk_type                VARCHAR(80),
    probability              DOUBLE PRECISION,
    is_active                BOOLEAN DEFAULT TRUE,
    note                     TEXT,
    created_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
