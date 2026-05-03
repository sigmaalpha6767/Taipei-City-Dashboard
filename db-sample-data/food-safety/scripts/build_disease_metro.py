"""依雙北人口與都會區疾病通報模式比例，從全國 TFDA 民國 112 年資料算出
雙北 / 臺北市 / 新北市 三個 scope 的食源性疾病分布。

來源比例假設（依疾管署都會區通報密度文獻 + 雙北佔全國人口 28% 推估）：
  - 雙北合計  ≈ 30% 全國（都會通報密度略高）
  - 臺北市    ≈ 40% 雙北（人口少但都會密度最高）
  - 新北市    ≈ 60% 雙北
  - 都會區發生機率較高的病原（諾羅、腸炎弧菌、輪狀）係數略高
  - 偏鄉/海港病原（河豚毒、肉毒、植物性天然毒）係數低
  - 河豚毒素 1 死於民國 112 年發生在離島，雙北為 0 死

Usage:
  python build_disease_metro.py > disease_metro_split.sql
"""
from __future__ import annotations
import csv, sys, math
from pathlib import Path

CSV = Path(__file__).resolve().parent.parent / "sources" / "disease_outbreak_real_tfda112.csv"

# 病原 → (metro %, taipei share of metro, newtaipei share of metro)
SCOPE_MULT = {
    "諾羅病毒":       (0.35, 0.40, 0.60),
    "沙門氏桿菌":     (0.28, 0.40, 0.60),
    "仙人掌桿菌":     (0.26, 0.40, 0.60),
    "金黃色葡萄球菌": (0.28, 0.40, 0.60),
    "腸炎弧菌":       (0.32, 0.40, 0.60),
    "病原性大腸桿菌": (0.25, 0.40, 0.60),
    "組織胺":         (0.20, 0.40, 0.60),
    "植物性天然毒":   (0.10, 0.40, 0.60),
    "河豚毒素":       (0.00, 0.00, 0.00),
    "輪狀病毒":       (0.30, 0.40, 0.60),
    "肉毒桿菌":       (0.00, 0.00, 0.00),
    "病因物質不明":   (0.30, 0.40, 0.60),
}


def s(v):
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def n(v):
    if v is None or v == "":
        return "0"
    try:
        return str(int(float(v)))
    except (ValueError, TypeError):
        return "0"


def main():
    rows = list(csv.DictReader(CSV.open(encoding="utf-8-sig")))

    out = []
    out.append("BEGIN;")
    out.append("")
    out.append("-- 1. 鬆綁 pathogen unique → 改為 (pathogen, data_scope) 複合 unique")
    out.append("ALTER TABLE public.disease_outbreak_stats")
    out.append("  DROP CONSTRAINT IF EXISTS disease_outbreak_stats_pathogen_key;")
    out.append("DELETE FROM public.disease_outbreak_stats")
    out.append("  WHERE data_scope IN ('metrotaipei','taipei','newtaipei');")
    out.append("CREATE UNIQUE INDEX IF NOT EXISTS")
    out.append("  ux_dos_pathogen_scope ON public.disease_outbreak_stats(pathogen, data_scope);")
    out.append("")
    out.append("INSERT INTO public.disease_outbreak_stats")
    out.append("(pathogen, pathogen_type, case_count, patient_count, death_count,")
    out.append(" case_share_pct, severity_level,")
    out.append(" related_foods, typical_settings, action_strategy, test_direction,")
    out.append(" incubation_hr, main_symptom, color_hex, sort_order,")
    out.append(" data_year, data_scope, notes) VALUES")

    sql_rows = []
    totals = {"metrotaipei": [0, 0, 0], "taipei": [0, 0, 0], "newtaipei": [0, 0, 0]}

    for r in rows:
        path = r["pathogen"].strip()
        ptype = r["pathogen_type"].strip()
        natl_case = int(float(r["case_count"]))
        natl_pat = int(float(r["patient_count"]))
        natl_death = int(float(r["death_count"]))
        natl_share = float(r["case_share_pct"])
        sev = r["severity_level"].strip()
        foods = r["related_foods"].strip()
        settings = r["typical_settings"].strip()
        action = r["action_strategy"].strip()
        test = r["test_direction"].strip()
        incub = r["incubation_hr"].strip()
        symptom = r["main_symptom"].strip()
        sort_o = int(float(r["sort_order"]))
        data_year = int(float(r["data_year"]))
        notes = r.get("notes", "").strip()

        metro_pct, t_share, nt_share = SCOPE_MULT.get(path, (0.30, 0.40, 0.60))
        metro_case = math.ceil(natl_case * metro_pct)
        metro_pat = math.ceil(natl_pat * metro_pct)
        metro_death = 0  # all assumed non-metro

        t_case = math.ceil(metro_case * t_share)
        t_pat = math.ceil(metro_pat * t_share)
        nt_case = max(metro_case - t_case, 0)
        nt_pat = max(metro_pat - t_pat, 0)

        for scope, c, p in [
            ("metrotaipei", metro_case, metro_pat),
            ("taipei",      t_case,    t_pat),
            ("newtaipei",   nt_case,   nt_pat),
        ]:
            totals[scope][0] += c
            totals[scope][1] += p
            sql_rows.append(
                "  ("
                + ", ".join([
                    s(path), s(ptype), str(c), str(p), "0",
                    f"{natl_share:.4f}",  # 保留全國 share 比例
                    s(sev), s(foods), s(settings), s(action), s(test),
                    s(incub), s(symptom), s("#888787"), str(sort_o),
                    str(data_year), s(scope), s(notes),
                ])
                + ")"
            )

    out.append(",\n".join(sql_rows) + ";")
    out.append("")
    out.append("-- summary")
    out.append("SELECT data_scope, COUNT(*) pathogens,")
    out.append("       SUM(case_count) cases, SUM(patient_count) patients, SUM(death_count) deaths")
    out.append("  FROM public.disease_outbreak_stats GROUP BY data_scope ORDER BY data_scope;")
    out.append("COMMIT;")

    sys.stderr.write(f"Generated {len(sql_rows)} rows ({len(SCOPE_MULT)} pathogens × 3 scopes)\n")
    for sc, (c, p, _) in totals.items():
        sys.stderr.write(f"  {sc}: cases={c} patients={p}\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
