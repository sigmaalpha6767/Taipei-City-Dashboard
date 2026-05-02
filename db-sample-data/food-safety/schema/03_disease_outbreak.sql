-- 食源性疾病統計表 — Component 6
--
-- 資料模型對齊：衛福部疾管署「食品中毒監視系統 (Foodborne Outbreak Surveillance)」
-- 與雙北市衛生局年度食品中毒事件統計報告的常見維度。
--
-- 用途：從病原統計反推「可能食材 + 處置策略 + 檢驗方向」，回答 codex 的問題：
--   「我們怎麼從症狀/病原反推可能食材，並決定下一步檢驗方向？」

CREATE TABLE IF NOT EXISTS disease_outbreak_stats (
    id              BIGSERIAL PRIMARY KEY,
    pathogen        VARCHAR(80) UNIQUE,         -- 病原名稱（諾羅病毒、沙門氏菌、…）
    pathogen_type   VARCHAR(40),                -- virus / bacteria / toxin / parasite / other
    case_count      INTEGER NOT NULL,           -- 雙北年度件數估計
    case_share_pct  DOUBLE PRECISION,           -- 占比%
    severity_level  VARCHAR(20),                -- high / medium / low（依群聚規模 + 嚴重併發症）
    related_foods   TEXT,                       -- 相關食材（逗號分隔）
    typical_settings TEXT,                       -- 典型發生場所
    action_strategy TEXT,                       -- 處置策略
    test_direction  TEXT,                       -- 檢驗方向（採樣對象）
    incubation_hr   VARCHAR(40),                -- 潛伏期
    main_symptom    VARCHAR(200),               -- 主要症狀
    color_hex       VARCHAR(20),                -- 視覺化顏色
    sort_order      INTEGER DEFAULT 0,
    notes           TEXT,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dos_type ON disease_outbreak_stats (pathogen_type);
CREATE INDEX IF NOT EXISTS idx_dos_severity ON disease_outbreak_stats (severity_level);
