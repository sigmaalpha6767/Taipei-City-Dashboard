#!/usr/bin/env python3
"""把脆弱場域 + 校園/長照清冊 + 當前事件灌進 postgres-data。

來源：
  - 開發文件/資料庫可用資料/新北市公立國小學區_export.csv          → school_directory (30 筆)
  - 開發文件/資料庫可用資料/新北市老人福利機構_export.csv          → care_facility_directory (30 筆)
  - Taipei-City-Dashboard-FE/public/data/prepared/vulnerable_exposure.json
        → vulnerable_facility_exposure (83 筆)
        → district_exposure_summary (17 筆)
        → food_event_current (1 筆)

執行：
  PYTHONIOENCODING=utf-8 python component4/scripts/ingest_vulnerable_to_db.py > /tmp/vex.sql
  docker exec -i postgres-data psql -U postgres -d dashboard < /tmp/vex.sql
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

# 自動偵測 sources 位置（兼容 repo 內 / 開發機兩種 layout）
HERE = Path(__file__).resolve().parent
_REPO_SRC = HERE.parent / "sources"
_LEGACY_SRC = HERE.parent.parent.parent.parent / "開發文件" / "資料庫可用資料"
_LEGACY_JSON = HERE.parent.parent.parent.parent / "Taipei-City-Dashboard" / "Taipei-City-Dashboard-FE" / "public" / "data" / "prepared" / "vulnerable_exposure.json"
if (_REPO_SRC / "新北市公立國小學區_export.csv").exists():
    SRC_SCHOOL = _REPO_SRC / "新北市公立國小學區_export.csv"
    SRC_CARE = _REPO_SRC / "新北市老人福利機構_export.csv"
    SRC_JSON = _REPO_SRC / "vulnerable_exposure.json"
else:
    SRC_SCHOOL = _LEGACY_SRC / "新北市公立國小學區_export.csv"
    SRC_CARE = _LEGACY_SRC / "新北市老人福利機構_export.csv"
    SRC_JSON = _LEGACY_JSON


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
        return f"{float(v):.6f}"
    except (ValueError, TypeError):
        return "NULL"


def bool_(v):
    return "TRUE" if v else "FALSE"


# === schools ===
def schools_sql():
    rows = []
    with SRC_SCHOOL.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append("(" + ", ".join([
                s(r.get("agency codes", "").strip()),
                s(r.get("sname", "").strip()),
                s(r.get("areacode", "").strip()),
                s("新北市"),
                s(r.get("district", "").strip()),
                s(r.get("pzoon", "").strip()[:1500]),
                s(r.get("fzoon", "").strip()[:1500]),
                s(r.get("mark", "").strip()[:500]),
            ]) + ")")
    sys.stderr.write(f"schools: {len(rows)}\n")
    print("TRUNCATE school_directory RESTART IDENTITY;")
    print("INSERT INTO school_directory")
    print("(agency_code, school_name, area_code, city, district, primary_zone, free_zone, note) VALUES")
    print(",\n".join(rows) + ";")


# === care facilities ===
def care_sql():
    rows = []
    with SRC_CARE.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append("(" + ", ".join([
                s(r.get("seqno", "").strip()),
                s(r.get("title", "").strip()),
                s(r.get("county", "").strip()),
                s(r.get("town", "").strip()),
                s(r.get("address", "").strip()),
                s(r.get("person_in_charge", "").strip()),
                s(r.get("localcallservice", "").strip()),
                n(r.get("bed_for_caring_quantity")),
                n(r.get("bed_for_nursing_quantity")),
                n(r.get("bed_for_longterm_quantity")),
                n(r.get("bed_for_azh_quantity")),
            ]) + ")")
    sys.stderr.write(f"care: {len(rows)}\n")
    print("TRUNCATE care_facility_directory RESTART IDENTITY;")
    print("INSERT INTO care_facility_directory")
    print("(seqno, facility_name, city, district, address, person_in_charge, phone,")
    print(" bed_caring, bed_nursing, bed_longterm, bed_azh) VALUES")
    print(",\n".join(rows) + ";")


# === facilities + districts + event from existing JSON ===
def exposure_sql():
    with SRC_JSON.open(encoding="utf-8") as fh:
        d = json.load(fh)

    # facilities (83)
    f_rows = []
    for x in d.get("facilities", []):
        f_rows.append("(" + ", ".join([
            s(x.get("facility_id")),
            s(x.get("facility_name", "")[:200]),
            s(x.get("facility_type")),
            s(x.get("city")),
            s(x.get("district")),
            s(x.get("address", "")[:500]),
            f(x.get("lat")),
            f(x.get("lng")),
            s(x.get("relation_type", "")[:80]),
            s(x.get("related_ingredient", "")[:80]),
            s(x.get("related_supplier", "")[:200]),
            n(x.get("exposure_population")),
            f(x.get("exposure_score")),
            s(x.get("risk_level")),
            s(x.get("suggested_attention", "")[:500]),
        ]) + ")")
    sys.stderr.write(f"facilities: {len(f_rows)}\n")
    print("TRUNCATE vulnerable_facility_exposure RESTART IDENTITY;")
    print("INSERT INTO vulnerable_facility_exposure")
    print("(facility_id, facility_name, facility_type, city, district, address,")
    print(" lat, lng, relation_type, related_ingredient, related_supplier,")
    print(" exposure_population, exposure_score, risk_level, suggested_attention) VALUES")
    print(",\n".join(f_rows) + ";")

    # district summary (17)
    d_rows = []
    for x in d.get("districts", []):
        d_rows.append("(" + ", ".join([
            s(x.get("city")),
            s(x.get("district")),
            n(x.get("affected_school_count")),
            n(x.get("affected_kindergarten_count")),
            n(x.get("affected_care_count")),
            f(x.get("elderly_ratio")),
            n(x.get("estimated_exposed_population")),
            f(x.get("exposure_score")),
            s(x.get("risk_level")),
            s(x.get("main_reason", "")[:500]),
        ]) + ")")
    sys.stderr.write(f"district summary: {len(d_rows)}\n")
    print("TRUNCATE district_exposure_summary RESTART IDENTITY;")
    print("INSERT INTO district_exposure_summary")
    print("(city, district, affected_school_count, affected_kindergarten_count,")
    print(" affected_care_count, elderly_ratio, estimated_exposed_population,")
    print(" exposure_score, risk_level, main_reason) VALUES")
    print(",\n".join(d_rows) + ";")

    # event (1)
    e = d.get("event", {})
    src_districts = ",".join(e.get("source_districts", [])) if e.get("source_districts") else ""
    print("TRUNCATE food_event_current RESTART IDENTITY;")
    print("INSERT INTO food_event_current")
    print("(event_id, event_type, event_date, suspected_ingredient, suspected_supplier_id,")
    print(" suspected_supplier_name, source_districts, risk_type, probability, is_active, note)")
    print("VALUES (" + ", ".join([
        s(e.get("event_id")),
        s(e.get("event_type")),
        s(e.get("event_date")) if e.get("event_date") else "NULL",
        s(e.get("suspected_ingredient")),
        s(e.get("suspected_supplier_id")),
        s(e.get("suspected_supplier_name")),
        s(src_districts),
        s(e.get("risk_type")),
        f(e.get("probability")),
        bool_(True),
        s(e.get("note", "")[:500]),
    ]) + ");")
    sys.stderr.write("event: 1\n")


def main():
    print("BEGIN;")
    schools_sql()
    care_sql()
    exposure_sql()
    print("COMMIT;")


if __name__ == "__main__":
    main()
