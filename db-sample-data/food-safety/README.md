# Food Safety 資料端設定

> 本目錄包含「食安 AI 應變中樞」相關的所有資料庫資產。
> 對齊資料端 → BE → FE 標準路徑：raw 資料存於 `postgres-data`，BE 用 SQL 聚合，FE 透過 BE endpoint 取資料（不再讀靜態 JSON）。

---

## TL;DR — 一鍵安裝

確認 `docker compose up -d` 已起、`postgres-data` / `dashboard-be` 都在跑後，repo 根目錄執行：

```bash
bash db-sample-data/food-safety/setup.sh
```

腳本會自動跑：建 schema、鬆綁 school unique 約束、灌兩份 SQL、重啟 BE、驗證筆數。

> **手動分步版本**（萬一 setup.sh 跑不了）：
> ```bash
> docker exec -i postgres-data psql -U postgres -d dashboard < db-sample-data/food-safety/schema/01_food_inspection.sql
> docker exec -i postgres-data psql -U postgres -d dashboard < db-sample-data/food-safety/schema/02_vulnerable_exposure.sql
> docker exec postgres-data psql -U postgres -d dashboard -c "ALTER TABLE school_directory DROP CONSTRAINT IF EXISTS school_directory_agency_code_key;"
> docker exec -i postgres-data psql -U postgres -d dashboard < db-sample-data/food-safety/data/03_food_inspection_data.sql
> docker exec -i postgres-data psql -U postgres -d dashboard < db-sample-data/food-safety/data/04_vulnerable_data.sql
> docker restart dashboard-be
> ```

跑完打開 http://localhost:8888/dashboard，「食安事件摘要」「行政區排行」「累犯店家」「脆弱族群暴露」等組件都會顯示真實數字。

---

## 目錄結構

```
db-sample-data/food-safety/
├── README.md                          # 本檔
├── schema/                            # 表 schema
│   ├── 01_food_inspection.sql         #   food_inspection_raw + index
│   └── 02_vulnerable_exposure.sql     #   school / care / facility / district / event 共 5 張
├── data/                              # 即可用 INSERT SQL（python 預先產好）
│   ├── 03_food_inspection_data.sql    #   368 筆食安抽驗（268 真實 + 100 mock）
│   └── 04_vulnerable_data.sql         #   30 校 + 30 長照 + 83 場域 + 17 行政區 + 1 事件
├── scripts/                           # 重新產 data SQL 的 python 腳本
│   ├── ingest_food_inspection_to_db.py
│   ├── replace_food_with_mock_only.py
│   └── ingest_vulnerable_to_db.py
└── sources/                           # raw 資料原檔（CSV / JSON）
    ├── 113年.csv                      #   臺北市衛生局 113 年食品抽驗清冊
    ├── mock_inspection_data.csv       #   雙北食品抽驗（模擬 100 筆）
    ├── 新北市公立國小學區_export.csv
    ├── 新北市老人福利機構_export.csv
    └── vulnerable_exposure.json       #   facilities + districts + event（component 4 預備好）
```

---

## DB 表清單

| 表 | 預期筆數 | 內容 | 來源 |
|---|---:|---|---|
| `food_inspection_raw` | 368 | 食安抽驗不合格清單 | 113年.csv + mock_inspection_data.csv |
| `school_directory` | 30 | 新北市公立國小學區 | 新北市公立國小學區_export.csv |
| `care_facility_directory` | 30 | 新北市老人福利機構 | 新北市老人福利機構_export.csv |
| `vulnerable_facility_exposure` | 83 | 受影響場域（含 lat/lng） | vulnerable_exposure.json `facilities` |
| `district_exposure_summary` | 17 | 各行政區暴露摘要 | vulnerable_exposure.json `districts` |
| `food_event_current` | 1 | 當前活動事件 | vulnerable_exposure.json `event` |

驗證指令：

```bash
docker exec postgres-data psql -U postgres -d dashboard -c "
SELECT 'food_inspection_raw' tbl, COUNT(*) FROM food_inspection_raw
UNION ALL SELECT 'school_directory', COUNT(*) FROM school_directory
UNION ALL SELECT 'care_facility_directory', COUNT(*) FROM care_facility_directory
UNION ALL SELECT 'vulnerable_facility_exposure', COUNT(*) FROM vulnerable_facility_exposure
UNION ALL SELECT 'district_exposure_summary', COUNT(*) FROM district_exposure_summary
UNION ALL SELECT 'food_event_current', COUNT(*) FROM food_event_current ORDER BY tbl;"
```

---

## BE Endpoints

裝好資料後，BE 自動暴露兩個公開 endpoint（無需 JWT）：

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/v1/food/summary` | 食安抽驗摘要 + 違規類別分布 + Top 食材 + 行政區排行 + 累犯店家 + per-city 聚合 |
| GET | `/api/v1/food/exposure` | 脆弱場域 83 筆 + 行政區摘要 17 筆 + 當前事件 + KPI |

LLM 4 個 tool（`get_food_risk_summary`、`get_top_recidivists`、`get_vulnerable_exposure`、`get_district_risk`）也走這幾張表。

驗證指令（dev nginx 走 8080，FE 走 8888）：

```bash
curl http://localhost:8080/api/dev/food/summary  | head -c 300
curl http://localhost:8080/api/dev/food/exposure | head -c 300
```

---

## 在 pgAdmin 看資料

1. 開 http://localhost:8889 用 `.env` 的 `PGADMIN_DEFAULT_*` 帳密登入
2. 左側 `Servers` 右鍵 → `Register` → `Server...`：
   | 分頁 | 欄位 | 值 |
   |---|---|---|
   | General | Name | `dashboard` |
   | Connection | Host name/address | `postgres-data` |
   | | Port | `5432` |
   | | Maintenance database | `dashboard` |
   | | Username | `postgres` |
   | | Password | （`.env` 的 `DB_DASHBOARD_PASSWORD`） |
3. 連上後，左側展開 `dashboard → Databases → dashboard → Schemas → public → Tables`，會看到 6 張食安表
4. 右鍵任一表 → `View/Edit Data` → `All Rows` 或 ⚡ Query Tool 跑 SQL

> **注意**：`postgres-data` 容器**沒對 host 暴露 port**（安全考量），所以無法從本機 DBeaver 直連。要透過 pgAdmin 容器（同 docker network）。

---

## 換／重建資料

### 場景 A：把 `food_inspection_raw` 換成「只有 mock」

```bash
PYTHONIOENCODING=utf-8 python db-sample-data/food-safety/scripts/replace_food_with_mock_only.py \
  | docker exec -i postgres-data psql -U postgres -d dashboard
```

### 場景 B：CSV 內容變更後重新產 data SQL

```bash
PYTHONIOENCODING=utf-8 python db-sample-data/food-safety/scripts/ingest_food_inspection_to_db.py \
  > db-sample-data/food-safety/data/03_food_inspection_data.sql

PYTHONIOENCODING=utf-8 python db-sample-data/food-safety/scripts/ingest_vulnerable_to_db.py \
  > db-sample-data/food-safety/data/04_vulnerable_data.sql

# 然後跑 TL;DR 那 6 行重新灌
```

### 場景 C：手動加幾筆（pgAdmin Query Tool）

```sql
INSERT INTO food_inspection_raw
(violation_id, source, sample_name, city, district,
 store_name, test_date, violation_type, violation_severity,
 reason_summary, is_mock)
VALUES
('MANUAL001', 'manual', '波菜', '臺北市', '信義區',
 '某早餐店', '2026-04-15', '農藥殘留', 90,
 '殺蟲劑 0.5ppm 超標', false);
```

---

## 資料流（架構閉環）

```
sources/*.csv,*.json
   │
   │ scripts/*.py 產 INSERT SQL
   ▼
data/*.sql
   │
   │ docker exec -i postgres-data psql ... < ...
   ▼
postgres-data (Postgres 16 + PostGIS)
   │
   │ Go GORM (models.DBDashboard.Raw)
   ▼
dashboard-be
   ├── /api/v1/food/summary    (controllers/food_safety.go)
   ├── /api/v1/food/exposure   (controllers/food_safety.go)
   └── /api/v1/ai/chat/twai    (LLM tool calling 走 services/ai/tools/food_safety.go)
   │
   │ axios via /api/dev proxy
   ▼
dashboard-fe
   ├── store/foodInspectionData.js (cache promise，每頁打一次)
   ├── store/aiAdvisorStore.js (AI 決策建議頁)
   └── 8 個 FoodSafety*.vue 組件（食安儀表板）
```

換資料只要動 Step 1（CSV/JSON）跟 Step 2（重新跑 ingest），下游全自動同步，不用碰 BE / FE 程式碼。
