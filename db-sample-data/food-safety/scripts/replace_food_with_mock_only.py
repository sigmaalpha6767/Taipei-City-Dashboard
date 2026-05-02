#!/usr/bin/env python3
"""把 food_inspection_raw 整張表替換為單一 CSV 的內容。

僅讀 mock_inspection_data_combined (2).csv → TRUNCATE + INSERT，
丟棄原本 268 筆 113 年真實資料 + 舊版 mock。

Usage:
  PYTHONIOENCODING=utf-8 python component4/scripts/replace_food_with_mock_only.py > food_replace.sql
  docker exec -i postgres-data psql -U postgres -d dashboard < food_replace.sql
"""
from __future__ import annotations

import sys
from pathlib import Path

# 重用 ingest 主腳本的解析邏輯（同目錄）
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest_food_inspection_to_db import read_mock  # noqa: E402


def main():
    rows = read_mock()
    sys.stderr.write(f"Generating SQL for {len(rows)} mock rows (replace mode)...\n")
    print("BEGIN;")
    print("TRUNCATE food_inspection_raw RESTART IDENTITY;")
    print("INSERT INTO food_inspection_raw")
    print("(violation_id, source, project, category, sample_name, city, district,")
    print(" store_name, address, test_date, violation_type, violation_severity,")
    print(" reason_summary, reason_full, lat, lng, is_mock) VALUES")
    print(",\n".join(rows) + ";")
    print("COMMIT;")


if __name__ == "__main__":
    main()
