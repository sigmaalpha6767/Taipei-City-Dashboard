"""Generate a SQL patch that adds food-safety components 220-224 (+related rows)
from the seed file to the live manager DB, without touching local-only rows
(components 400/403, dashboards 400/401, etc.).

Usage:
  python build_food_patch.py > food_patch.sql
  docker exec -i postgres-manager psql -U postgres -d dashboardmanager < food_patch.sql
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

SEED = Path(__file__).resolve().parents[1] / "dashboardmanager-demo.sql"
content = SEED.read_text(encoding="utf-8")

# Split out each COPY block.
sections = {}
for m in re.finditer(
    r"COPY (public\.[a-z_]+) \(([^)]+)\) FROM stdin;\n((?:.*\n)*?)\\\.\n",
    content,
):
    table, cols, body = m.group(1), m.group(2), m.group(3)
    rows = [line for line in body.splitlines() if line]
    sections[table] = {"cols": cols, "rows": rows}

FOOD_INDEXES = {
    "food_safety_vulnerable_exposure",
    "food_safety_care_exposure",
    "food_safety_risk_inspection",
    "food_safety_citizen_radar",
    "food_safety_disease_stats",
}
FOOD_COMPONENT_IDS = {220, 221, 222, 223, 224}
FOOD_MAP_IDS = {200, 201, 202, 210, 211}


def first_col(row: str) -> str:
    return row.split("\t", 1)[0]


def emit_copy_block(table: str, predicate) -> None:
    s = sections[table]
    rows = [r for r in s["rows"] if predicate(r)]
    if not rows:
        return
    print(f"COPY {table} ({s['cols']}) FROM stdin;")
    for r in rows:
        print(r)
    print("\\.")
    print()


print("-- Food-safety patch: adds components 220-224 + related charts/maps/query_charts")
print("-- Generated from db-sample-data/dashboardmanager-demo.sql")
print("BEGIN;")
print()

# Cleanly remove any partial leftovers under our managed indexes.
print("DELETE FROM public.query_charts WHERE index IN (")
print("  " + ", ".join(f"'{i}'" for i in sorted(FOOD_INDEXES)))
print(");")
print("DELETE FROM public.component_charts WHERE index IN (")
print("  " + ", ".join(f"'{i}'" for i in sorted(FOOD_INDEXES)))
print(");")
print(f"DELETE FROM public.component_maps WHERE id IN ({','.join(map(str, sorted(FOOD_MAP_IDS)))});")
print(f"DELETE FROM public.components   WHERE id IN ({','.join(map(str, sorted(FOOD_COMPONENT_IDS)))});")
print()

emit_copy_block("public.component_charts", lambda r: first_col(r) in FOOD_INDEXES)
emit_copy_block("public.component_maps",   lambda r: int(first_col(r)) in FOOD_MAP_IDS)
emit_copy_block("public.components",       lambda r: int(first_col(r)) in FOOD_COMPONENT_IDS)
emit_copy_block("public.query_charts",     lambda r: first_col(r) in FOOD_INDEXES)

# Realign the existing dashboard 358 to reference the new food components,
# and add the new food_safety dashboards (id 357, 357M) only if they exist in seed.
print("-- Re-link dashboard 358 (practical_transportation_newtpe) to include 220, 223")
print("UPDATE public.dashboards SET components = '{60,212,213,220,223}' WHERE id = 358;")
print()

# Bump sequences so future inserts don't collide.
print("SELECT setval(pg_get_serial_sequence('public.components', 'id'),")
print("              GREATEST(COALESCE(MAX(id),0), 224)) FROM public.components;")
print("SELECT setval(pg_get_serial_sequence('public.component_maps', 'id'),")
print("              GREATEST(COALESCE(MAX(id),0), 211)) FROM public.component_maps;")
print()
print("COMMIT;")
