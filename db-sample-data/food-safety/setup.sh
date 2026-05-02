#!/usr/bin/env bash
# 食安資料端一鍵安裝 — clone repo + docker compose 都跑完後，執行此腳本即可灌好所有食安資料。
#
# 用法（在 repo root）：
#   bash db-sample-data/food-safety/setup.sh
#
# 預設假設：postgres-data / postgres-manager / dashboard-be 容器都在跑。

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA="$SCRIPT_DIR/schema"
DATA="$SCRIPT_DIR/data"

echo "▸ Step 1/7: 建立 food_inspection_raw 表 schema"
docker exec -i postgres-data psql -U postgres -d dashboard < "$SCHEMA/01_food_inspection.sql"

echo "▸ Step 2/7: 建立 vulnerable_exposure 系列表 schema (5 張)"
docker exec -i postgres-data psql -U postgres -d dashboard < "$SCHEMA/02_vulnerable_exposure.sql"

echo "▸ Step 3/7: 建立 disease_outbreak_stats 表 schema (Component 6)"
docker exec -i postgres-data psql -U postgres -d dashboard < "$SCHEMA/03_disease_outbreak.sql"

echo "▸ Step 4/7: 鬆綁 school_directory.agency_code unique 約束"
docker exec postgres-data psql -U postgres -d dashboard \
  -c "ALTER TABLE school_directory DROP CONSTRAINT IF EXISTS school_directory_agency_code_key;" \
  > /dev/null

echo "▸ Step 5/7: 灌食安抽驗資料 (368 筆)"
docker exec -i postgres-data psql -U postgres -d dashboard < "$DATA/03_food_inspection_data.sql" | tail -3

echo "▸ Step 6/7: 灌脆弱場域資料 (校 + 長照 + 場域 + 行政區 + 事件)"
docker exec -i postgres-data psql -U postgres -d dashboard < "$DATA/04_vulnerable_data.sql" | tail -3

echo "▸ Step 7/7: 灌食源性疾病統計 (7 種病原)"
docker exec -i postgres-data psql -U postgres -d dashboard < "$DATA/05_disease_outbreak_data.sql" | tail -3

echo ""
echo "▸ 驗證："
docker exec postgres-data psql -U postgres -d dashboard -c "
SELECT 'food_inspection_raw' tbl, COUNT(*) FROM food_inspection_raw
UNION ALL SELECT 'school_directory', COUNT(*) FROM school_directory
UNION ALL SELECT 'care_facility_directory', COUNT(*) FROM care_facility_directory
UNION ALL SELECT 'vulnerable_facility_exposure', COUNT(*) FROM vulnerable_facility_exposure
UNION ALL SELECT 'district_exposure_summary', COUNT(*) FROM district_exposure_summary
UNION ALL SELECT 'food_event_current', COUNT(*) FROM food_event_current
UNION ALL SELECT 'disease_outbreak_stats', COUNT(*) FROM disease_outbreak_stats
ORDER BY tbl;"

echo ""
echo "▸ 重啟 dashboard-be 讓 BE 拿到最新資料"
docker restart dashboard-be > /dev/null
echo "  等待 BE 起來..."
until curl -sf -o /dev/null http://localhost:8080/api/dev/food/summary --max-time 5 2>/dev/null; do
  sleep 2
done
echo ""
echo "✓ 完成！打開 http://localhost:8888/dashboard 即可看到食安組件。"
echo "✓ AI 決策建議頁: http://localhost:8888/ai-advisor (無需登入)"
