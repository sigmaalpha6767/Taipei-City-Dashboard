#!/usr/bin/env python3
"""從 postgres-data.food_inspection_raw 重新產出 mapData/inspection_failure_point.geojson。

對齊「DB 是 source of truth」：當 food_inspection_raw 換資料後，跑此腳本同步靜態 GeoJSON。
mapStore 仍然從 /mapData/inspection_failure_point.geojson 讀 → 看到 DB 資料的 snapshot。

對於 lat/lng 為 NULL 的 row（mock 資料沒 geocoding），用該行政區的 centroid 加微小隨機偏移，
讓 map 點散在區內，至少視覺化得到。

執行：
  PYTHONIOENCODING=utf-8 python db-sample-data/food-safety/scripts/export_geojson_from_db.py
"""
from __future__ import annotations

import json
import os
import random
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
OUT = REPO_ROOT / "Taipei-City-Dashboard-FE" / "public" / "mapData" / "inspection_failure_point.geojson"

# 雙北行政區大致 centroid（手工查找，足夠把點散在區內）
DISTRICT_CENTROIDS = {
    # 臺北市
    "中正區": (121.520, 25.032),
    "大同區": (121.514, 25.066),
    "中山區": (121.533, 25.064),
    "松山區": (121.557, 25.058),
    "大安區": (121.543, 25.026),
    "萬華區": (121.498, 25.034),
    "信義區": (121.575, 25.033),
    "士林區": (121.519, 25.094),
    "北投區": (121.501, 25.132),
    "內湖區": (121.589, 25.069),
    "南港區": (121.606, 25.054),
    "文山區": (121.570, 24.990),
    # 新北市（部分常見區）
    "板橋區": (121.459, 25.011),
    "三重區": (121.488, 25.063),
    "中和區": (121.498, 24.999),
    "永和區": (121.513, 25.007),
    "新莊區": (121.450, 25.036),
    "新店區": (121.541, 24.967),
    "土城區": (121.443, 24.973),
    "蘆洲區": (121.473, 25.085),
    "樹林區": (121.421, 24.991),
    "汐止區": (121.629, 25.069),
    "鶯歌區": (121.354, 24.954),
    "三峽區": (121.371, 24.934),
    "淡水區": (121.444, 25.169),
    "瑞芳區": (121.808, 25.108),
    "三芝區": (121.500, 25.258),
    "石門區": (121.568, 25.290),
    "八里區": (121.398, 25.146),
    "林口區": (121.391, 25.077),
    "金山區": (121.638, 25.222),
    "萬里區": (121.689, 25.181),
    "深坑區": (121.615, 25.001),
    "石碇區": (121.661, 24.992),
    "坪林區": (121.711, 24.939),
    "雙溪區": (121.866, 25.038),
    "貢寮區": (121.908, 25.022),
    "平溪區": (121.738, 25.026),
    "烏來區": (121.551, 24.866),
    "泰山區": (121.430, 25.060),
    "五股區": (121.438, 25.083),
}


def query_db():
    """跑 docker exec psql 拉資料（avoid 裝 psycopg2）。
    用 psql -A -t 模式：tuples-only + unaligned，分隔符 |。"""
    sql = (
        "SELECT violation_id, store_name, sample_name, category, project, district, "
        "address, test_date::text, violation_type, violation_severity, reason_summary, "
        "COALESCE(lat::text, ''), COALESCE(lng::text, ''), is_mock::text "
        "FROM food_inspection_raw ORDER BY id;"
    )
    result = subprocess.run(
        ["docker", "exec", "-i", "postgres-data",
         "psql", "-U", "postgres", "-d", "dashboard",
         "-A", "-t", "-F", "▒",  # 分隔符用罕見字符避免欄位裡的 tab/| 干擾
         "-c", sql],
        capture_output=True, text=True, encoding="utf-8",
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql failed: {result.stderr}")
    rows = []
    for line in result.stdout.strip().split("\n"):
        if not line.strip():
            continue
        cols = line.split("▒")
        if len(cols) < 14:
            continue
        rows.append({
            "violation_id": cols[0],
            "store_name": cols[1],
            "sample_name": cols[2],
            "category": cols[3],
            "project": cols[4],
            "district": cols[5],
            "address": cols[6],
            "test_date": cols[7],
            "violation_type": cols[8],
            "violation_severity": int(cols[9]) if cols[9] else 0,
            "reason_summary": cols[10],
            "lat": float(cols[11]) if cols[11] else None,
            "lng": float(cols[12]) if cols[12] else None,
            "is_mock": cols[13].strip() == "t",
        })
    return rows


def jitter(centroid, vid):
    """以 violation_id 為 seed 做小幅偏移，讓同區點散開。"""
    rng = random.Random(vid)
    lng, lat = centroid
    return (lng + (rng.random() - 0.5) * 0.012, lat + (rng.random() - 0.5) * 0.012)


def main():
    rows = query_db()
    features = []
    skipped = 0
    for r in rows:
        lng, lat = r["lng"], r["lat"]
        if lng is None or lat is None:
            centroid = DISTRICT_CENTROIDS.get(r["district"])
            if not centroid:
                skipped += 1
                continue
            lng, lat = jitter(centroid, r["violation_id"])
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]},
            "properties": {
                "violation_id": r["violation_id"],
                "store_name": r["store_name"],
                "sample_name": r["sample_name"],
                "category": r["category"],
                "project": r["project"],
                "district": r["district"],
                "address": r["address"],
                "test_date": r["test_date"],
                "violation_type": r["violation_type"],
                "violation_severity": r["violation_severity"],
                "reason_summary": r["reason_summary"],
                "is_mock": r["is_mock"],
            },
        })
    out = {"type": "FeatureCollection", "features": features}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {len(features)} features to {OUT}")
    print(f"  skipped (district 未知 + lat/lng null): {skipped}")


if __name__ == "__main__":
    main()
