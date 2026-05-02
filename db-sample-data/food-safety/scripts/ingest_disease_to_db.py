#!/usr/bin/env python3
"""把真實 TFDA / CDC 食品中毒統計 CSV 灌進 disease_outbreak_stats 表。

使用情境：
  1. 從 https://www.fda.gov.tw/TC/siteList.aspx?sid=323 抓最新年度報告
  2. 從 https://data.gov.tw 抓「食品中毒原因（病因物質）分類統計」
  3. 整理成 sources/disease_outbreak_real.csv（schema 對齊 modeled.csv）
  4. 執行此 script 替換掉 modeled 估算

CSV 預期欄位：
  pathogen, pathogen_type, case_count, case_share_pct, severity_level,
  related_foods, typical_settings, action_strategy, test_direction,
  incubation_hr, main_symptom, sort_order, notes

執行：
  PYTHONIOENCODING=utf-8 python ingest_disease_to_db.py [path/to/real.csv] \
    | docker exec -i postgres-data psql -U postgres -d dashboard
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_CSV = HERE.parent / "sources" / "disease_outbreak_real.csv"
MODELED_CSV = HERE.parent / "sources" / "disease_outbreak_modeled.csv"


def s(v):
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def n(v):
    if v is None or v == "":
        return "NULL"
    try:
        return str(int(float(v)))
    except (ValueError, TypeError):
        return "NULL"


def f(v):
    if v is None or v == "":
        return "NULL"
    try:
        return f"{float(v):.4f}"
    except (ValueError, TypeError):
        return "NULL"


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV
    if not src.exists():
        sys.stderr.write(f"找不到 {src}\n")
        sys.stderr.write(f"提示：可先用 modeled 估算版 {MODELED_CSV.name} 測試\n")
        sys.exit(1)

    rows = []
    with src.open(encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            rows.append("(" + ", ".join([
                s(r.get("pathogen", "").strip()),
                s(r.get("pathogen_type", "").strip()),
                n(r.get("case_count")),
                n(r.get("patient_count", "")),
                n(r.get("death_count", "")),
                f(r.get("case_share_pct")),
                s(r.get("severity_level", "").strip()),
                s(r.get("related_foods", "").strip()),
                s(r.get("typical_settings", "").strip()),
                s(r.get("action_strategy", "").strip()),
                s(r.get("test_direction", "").strip()),
                s(r.get("incubation_hr", "").strip()),
                s(r.get("main_symptom", "").strip()),
                s("#888787"),  # color_hex 預設灰
                n(r.get("sort_order")) if r.get("sort_order") else "0",
                n(r.get("data_year", "")),
                s(r.get("data_scope", "national").strip()),
                s(r.get("notes", "").strip()),
            ]) + ")")

    sys.stderr.write(f"產 {len(rows)} 筆 INSERT from {src.name}\n")
    print("BEGIN;")
    print("TRUNCATE disease_outbreak_stats RESTART IDENTITY;")
    print("INSERT INTO disease_outbreak_stats")
    print("(pathogen, pathogen_type, case_count, patient_count, death_count,")
    print(" case_share_pct, severity_level,")
    print(" related_foods, typical_settings, action_strategy, test_direction,")
    print(" incubation_hr, main_symptom, color_hex, sort_order,")
    print(" data_year, data_scope, notes) VALUES")
    print(",\n".join(rows) + ";")
    print("COMMIT;")


if __name__ == "__main__":
    main()
