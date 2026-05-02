#!/usr/bin/env python3
"""把食安抽驗 raw CSV 灌進 postgres-data.food_inspection_raw 表。

對齊資料端→BE→FE 的標準路徑：
  raw CSV → 此 script → postgres-data raw 表 → BE Go tool 用 SQL 查 → LLM/Chart

來源：
  - 113年 (1).csv                          269 筆真實 (臺北衛生局)
  - mock_inspection_data_combined (2).csv   99 筆 mock (雙北混合)

執行方式（不需 psycopg2，直接產 SQL 後 pipe 進 postgres）：
  PYTHONIOENCODING=utf-8 python db-sample-data/food-safety/scripts/ingest_food_inspection_to_db.py \\
    | docker exec -i postgres-data psql -U postgres -d dashboard
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

# 自動偵測 sources 位置，兼容兩種 layout：
#   - repo 內: db-sample-data/food-safety/sources/
#   - 開發機: ../開發文件/資料庫可用資料/
HERE = Path(__file__).resolve().parent
_REPO_SRC = HERE.parent / "sources"
_LEGACY_SRC = HERE.parent.parent.parent.parent / "開發文件" / "資料庫可用資料"
if (_REPO_SRC / "113年.csv").exists():
    SRC_TPE = _REPO_SRC / "113年.csv"
    SRC_MOCK = _REPO_SRC / "mock_inspection_data.csv"
else:
    SRC_TPE = _LEGACY_SRC / "113年 (1).csv"
    SRC_MOCK = _LEGACY_SRC / "mock_inspection_data_combined (2).csv"

ZIP_TO_DISTRICT = {
    "100": "中正區", "103": "大同區", "104": "中山區", "105": "松山區",
    "106": "大安區", "108": "萬華區", "110": "信義區", "111": "士林區",
    "112": "北投區", "114": "內湖區", "115": "南港區", "116": "文山區",
}
ALL_DISTRICTS = set(ZIP_TO_DISTRICT.values()) | {
    "板橋區", "三重區", "中和區", "永和區", "新莊區", "新店區", "土城區",
    "蘆洲區", "樹林區", "汐止區", "鶯歌區", "三峽區", "淡水區", "瑞芳區",
    "三芝區", "石門區", "八里區", "林口區", "金山區", "萬里區", "深坑區",
    "石碇區", "坪林區", "雙溪區", "貢寮區", "平溪區", "烏來區", "泰山區",
    "五股區",
}
SEVERITY = {
    "重金屬": 100, "農藥殘留": 90, "微生物": 85, "動物用藥": 80,
    "防腐劑與添加物": 70, "標示不符": 50, "其他": 60,
}
CATEGORY_KEYWORDS = [
    ("小葉菜類", ["白菜", "青江菜", "茼蒿", "菠菜", "油菜", "蕹菜", "莧菜", "A菜"]),
    ("根莖菜類", ["蘿蔔", "馬鈴薯", "紅蘿蔔", "胡蘿蔔", "地瓜", "山藥", "牛蒡", "藕"]),
    ("果菜類", ["茄", "椒", "瓜", "番茄"]),
    ("豆菜類", ["豆", "豌豆", "毛豆", "四季豆"]),
    ("香辛植物及其他草木本植物", ["蔥", "薑", "蒜", "韭", "九層塔", "羅勒", "香菜", "芫荽", "辣椒"]),
    ("大漿果類", ["木瓜", "芒果", "鳳梨", "百香果", "釋迦"]),
    ("小漿果類", ["草莓", "葡萄", "藍莓"]),
    ("核果類", ["桃", "李", "梅", "杏"]),
    ("柑桔類", ["橘", "柳丁", "葡萄柚", "金棗", "檸檬", "萊姆"]),
    ("肉品", ["肉", "雞", "鴨", "鵝", "豬", "牛", "羊"]),
    ("蛋品", ["蛋"]),
    ("乳品", ["奶", "乳", "起司"]),
    ("水產", ["魚", "蝦", "蟹", "貝", "魷"]),
    ("加工食品", ["丸", "腸", "餃", "包子", "饅頭"]),
]


def classify_violation(reason: str) -> str:
    if not reason:
        return "其他"
    if re.search(r"鎘|鉛|汞|砷|重金屬", reason):
        return "重金屬"
    if re.search(r"殺蟲劑|殺菌劑|除草劑|安丹|陶斯松|凡殺|農藥|ppm|ppb", reason):
        return "農藥殘留"
    if re.search(r"CFU|生菌|大腸桿菌|沙門|李斯特|腸炎|腸桿菌|金黃色葡萄球|微生物", reason):
        return "微生物"
    if re.search(r"動物用藥|抗生素|磺胺|四環素|氯黴素|trimethoprim|Doxycycline", reason):
        return "動物用藥"
    if re.search(r"防腐|苯甲酸|己二烯|二氧化硫|漂白|甜味劑|色素|食品添加|leucocrystal|結晶紫", reason):
        return "防腐劑與添加物"
    if re.search(r"標示", reason):
        return "標示不符"
    return "其他"


def classify_category(sample_name: str) -> str:
    if not sample_name:
        return "未分類"
    for cat, keywords in CATEGORY_KEYWORDS:
        if any(k in sample_name for k in keywords):
            return cat
    return "其他食品"


def normalize_address(loc: str) -> tuple[str, str]:
    if "/" in loc:
        name, _, addr = loc.partition("/")
        return name.strip(), addr.strip()
    return loc.strip(), loc.strip()


def parse_date(yyyymmdd: str):
    s = (yyyymmdd or "").strip()
    if len(s) != 8 or not s.isdigit():
        return None
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def detect_city_district(loc: str, zip_code: str | None) -> tuple[str, str]:
    if zip_code and zip_code in ZIP_TO_DISTRICT:
        return "臺北市", ZIP_TO_DISTRICT[zip_code]
    if "臺北" in loc or "台北" in loc:
        for d in ALL_DISTRICTS:
            if d in loc:
                return "臺北市", d
        return "臺北市", "未知"
    if "新北" in loc:
        for d in ALL_DISTRICTS:
            if d in loc:
                return "新北市", d
        return "新北市", "未知"
    return "其他", "未知"


def sql_str(s):
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def sql_int(n):
    return "NULL" if n is None else str(int(n))


def sql_bool(b):
    return "TRUE" if b else "FALSE"


def sql_date(d):
    return f"'{d}'" if d else "NULL"


def emit_row(vid, source, project, category, sample_name, city, district,
             store, addr, test_date, v_type, severity, reason_summary,
             reason_full, lat, lng, is_mock):
    return "(" + ", ".join([
        sql_str(vid), sql_str(source), sql_str(project), sql_str(category),
        sql_str(sample_name), sql_str(city), sql_str(district),
        sql_str(store), sql_str(addr), sql_date(test_date),
        sql_str(v_type), sql_int(severity),
        sql_str(reason_summary), sql_str(reason_full),
        sql_int(lat), sql_int(lng), sql_bool(is_mock),
    ]) + ")"


def read_taipei_real():
    out = []
    with SRC_TPE.open(encoding="utf-8-sig") as f:
        for i, r in enumerate(csv.DictReader(f), 1):
            if r["檢驗結果"].strip() != "不符合規定":
                continue
            store, addr = normalize_address(r["抽驗地點"])
            zip_code = r["抽驗行政郵遞區號"].strip()
            city, district = detect_city_district(r["抽驗地點"], zip_code)
            v_type = classify_violation(r["不符合規定原因"])
            out.append(emit_row(
                f"TPE{i:04d}", "113年臺北市", r["專案名稱"].strip(),
                r["分類"].strip() or classify_category(r["檢體名稱"]),
                r["檢體名稱"].strip(), city, district, store, addr,
                parse_date(r["抽驗日期"]), v_type, SEVERITY.get(v_type, 60),
                r["不符合規定原因"].strip().split("\n")[0][:300],
                r["不符合規定原因"].strip(),
                None, None, False,
            ))
    return out


def read_mock():
    out = []
    with SRC_MOCK.open(encoding="utf-8-sig") as f:
        for i, r in enumerate(csv.DictReader(f), 1):
            if r["檢驗結果"].strip() != "不符合規定":
                continue
            store, addr = normalize_address(r["抽驗地點"])
            city, district = detect_city_district(r["抽驗地點"], None)
            v_type = classify_violation(r["不符合規定原因"])
            out.append(emit_row(
                f"MOCK{i:04d}", "mock", "雙北食品抽驗（模擬）",
                classify_category(r["檢體名稱"]),
                r["檢體名稱"].strip(), city, district, store, addr,
                parse_date(r["抽驗日期"]), v_type, SEVERITY.get(v_type, 60),
                r["不符合規定原因"].strip().split("\n")[0][:300],
                r["不符合規定原因"].strip(),
                None, None, True,
            ))
    return out


def main():
    rows = read_taipei_real() + read_mock()
    sys.stderr.write(f"Generating SQL for {len(rows)} rows...\n")
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
