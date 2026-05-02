#!/usr/bin/env python3
"""把舊 inspection_failure_point.geojson 的 lat/lng 寫回 food_inspection_raw。

對齊邏輯：用 violation_id 比對（V0001 對 V0001）。
mock 資料（MOCK0001 開頭）沒對應，會留 NULL。

Usage:
  PYTHONIOENCODING=utf-8 python db-sample-data/food-safety/scripts/sync_geo_to_db.py \\
    | docker exec -i postgres-data psql -U postgres -d dashboard
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
GEOJSON = REPO_ROOT / "Taipei-City-Dashboard-FE" / "public" / "mapData" / "inspection_failure_point.geojson"


def main():
    d = json.loads(GEOJSON.read_text(encoding="utf-8"))
    feats = d.get("features", [])
    sys.stderr.write(f"GeoJSON has {len(feats)} features\n")

    print("BEGIN;")
    updated = 0
    for f in feats:
        p = f.get("properties", {})
        vid = p.get("violation_id", "").strip()
        if not vid:
            continue
        coords = f.get("geometry", {}).get("coordinates")
        if not coords or len(coords) < 2:
            continue
        lng, lat = float(coords[0]), float(coords[1])
        print(f"UPDATE food_inspection_raw SET lat = {lat:.6f}, lng = {lng:.6f} "
              f"WHERE violation_id = '{vid}';")
        updated += 1
    print("COMMIT;")
    sys.stderr.write(f"Generated {updated} UPDATE statements\n")


if __name__ == "__main__":
    main()
