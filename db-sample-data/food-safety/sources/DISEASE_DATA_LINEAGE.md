# Component 6 食源性疾病統計 — 資料 lineage（誠實標示）

## 結論先說

**目前 `disease_outbreak_stats` 表內的 7 筆資料不是從真實 TFDA / CDC 公開資料抓取的，是依公衛標準知識建模出來的「典型雙北年度分布」估算。**

| 欄位 | 真實性 | 說明 |
|---|---|---|
| `pathogen` 名稱 | ✓ 真實 | 諾羅 / 沙門 / 腸炎弧菌 等都是 CDC 公告法定通報病原 |
| `pathogen_type` | ✓ 真實 | virus / bacteria 分類符合微生物學 |
| `related_foods` | ✓ 真實（公衛標準） | 例如沙門對應蛋/雞肉、腸炎弧菌對應海鮮 — 是 CDC/WHO 教科書關聯 |
| `main_symptom` | ✓ 真實（醫學標準） | 潛伏期、症狀都是傳染病學標準 |
| `incubation_hr` | ✓ 真實（醫學標準） | 同上 |
| `typical_settings` | ✓ 真實（流行病學標準） | 例如諾羅常見學校群聚是公衛常識 |
| `action_strategy` | ✓ 真實（公衛回應 SOP） | 隔離、消毒、稽查方向都是法定 SOP |
| `test_direction` | ✓ 真實（檢驗標準） | RT-PCR、培養、拭子採樣是實驗室診斷標準 |
| `severity_level` | ✓ 真實（臨床評估） | 依群聚規模 + 併發症的常見分檔 |
| **`case_count`** | **✗ 估算** | **27/18/14/9/6/5/9 是依典型百分比建模，非真實統計** |
| **`case_share_pct`** | **✗ 估算** | **同上，根據疾管署歷年公開比率反推** |

## 為什麼是估算

當初做這 component 時嘗試開瀏覽器抓 https://data.gov.tw 與 data.cdc.gov.tw，但被權限擋下。為了不卡住 demo，改用我對 衛福部疾管署「食品中毒監視系統」歷年年報的占比知識（諾羅 ~30% / 沙門 ~20% / 腸炎弧菌 ~15% / 金黃葡萄 ~10% / 仙人掌桿 ~7% / 大腸桿菌 ~5% / 其他 ~13%）反推到雙北年度合理規模 88 件。

## 真實資料怎麼補

要把這 7 筆換成真實 TFDA / CDC 統計，建議路徑：

### 路徑 A：TFDA 食品中毒案件統計（最直接）
- 來源：https://www.fda.gov.tw/TC/siteList.aspx?sid=323
- 格式：年度報告 PDF / Excel
- 動作：手動下載最新一年（例如 113 年食品中毒案件統計分析）→ 解析病原占比 → 寫個 Python 腳本灌進 DB

### 路徑 B：政府資料開放平台
- 來源：https://data.gov.tw/dataset?q=%E9%A3%9F%E5%93%81%E4%B8%AD%E6%AF%92
- 找「食品中毒原因(病因物質)分類統計」之類的 dataset
- 多半提供 CSV/JSON 直接下載

### 路徑 C：CDC 法定傳染病開放資料
- 來源：https://data.cdc.gov.tw
- 對應病原：sandwich 性大腸桿菌、傷寒、桿菌性痢疾
- 適合補充 case_count，但 CDC 是「人」的統計，TFDA 是「事件」統計，兩者規模不同要對齊

## 怎麼換掉現在的估算（兩步）

```bash
# 1. 真實 CSV 放 sources/disease_outbreak_real.csv（schema 對齊上面那份 modeled.csv）

# 2. 跑這個（要寫一個 ingest 腳本；現在還沒寫，需要才做）
python db-sample-data/food-safety/scripts/ingest_disease_to_db.py \
  --source db-sample-data/food-safety/sources/disease_outbreak_real.csv \
  | docker exec -i postgres-data psql -U postgres -d dashboard
```

## 目前 lineage（透明標示）

`05_disease_outbreak_data.sql` 由 `disease_outbreak_modeled.csv`（這份）灌入，
而 `disease_outbreak_modeled.csv` 是我（AI agent）在建模當下產出的，
**標示為 modeled、非 scraped**，避免被誤當真實 surveillance data 引用。

呈現面（FE 組件、AI Advisor）已在 BE response 的 `metadata.note` 標明：
> 「資料模型對齊衛福部疾管署歷年公開統計，數值為雙北年度典型分布」

如果要 demo 給評審，**建議在 component 上加一個 ⓘ tooltip 寫「件數為依疾管署典型分布建模估算，待換真實年度報告」**，誠實標示比偽裝更得分。
