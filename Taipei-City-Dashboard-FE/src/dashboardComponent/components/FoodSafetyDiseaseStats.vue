<!-- Component 6 — 食源性疾病統計（病原 → 可能食材 + 處置策略 + 檢驗方向） -->
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { loadFoodDiseaseStats } from "../../store/foodInspectionData";

const props = defineProps([
	"chart_config", "activeChart", "activeCity", "series",
	"map_config", "map_filter", "map_filter_on",
]);

const payload = ref(null);
const selected = ref(null);

// City 從 activeCity prop 或 query_charts 帶下來的 city（用 props.activeCity 為主，因為這個元件沒有 map_config）
const cityKey = computed(() => props.activeCity || "");

async function load() {
	try {
		payload.value = await loadFoodDiseaseStats({ city: cityKey.value });
		// 預設選第一筆（諾羅病毒）
		if (payload.value?.items?.length && !selected.value) {
			selected.value = payload.value.items[0].pathogen;
		}
	} catch (e) { /* silent */ }
}
onMounted(load);
watch(cityKey, () => { selected.value = null; load(); });

const items = computed(() => payload.value?.items ?? []);
const summary = computed(() => payload.value?.summary ?? {});
const metadata = computed(() => payload.value?.metadata ?? {});
const isModeled = computed(() => metadata.value?.data_kind === "modeled");
const isReal = computed(() => metadata.value?.data_kind === "real");
const dataYearROC = computed(() => {
	const y = metadata.value?.data_year;
	return y ? `民國 ${y - 1911} 年` : "";
});
const selectedItem = computed(() =>
	items.value.find((x) => x.pathogen === selected.value) ?? items.value[0],
);

const maxCases = computed(() =>
	Math.max(1, ...items.value.map((x) => x.case_count)),
);

const SEV_LABEL = { high: "高", medium: "中", low: "低" };

function pickPathogen(p) {
	selected.value = p;
}
</script>

<template>
	<div v-if="activeChart === 'FoodSafetyDiseaseStats' && payload" class="ddx">
		<!-- 資料來源標示 -->
		<div v-if="isReal" class="ddx__lineage ddx__lineage--real" :title="metadata.note">
			✓ {{ dataYearROC }}全國食品中毒統計 · 來源：衛福部食藥署 (TFDA)
		</div>

		<!-- Summary KPI（4 格）-->
		<div class="ddx__kpis">
			<div class="ddx__kpi">
				<span class="ddx__kpi-num">{{ summary.total_cases }}</span>
				<span class="ddx__kpi-lab">年度總件數</span>
			</div>
			<div class="ddx__kpi">
				<span class="ddx__kpi-num ddx__kpi-num--hi">{{ summary.identified_cases }}</span>
				<span class="ddx__kpi-lab">病因判明（{{ summary.identified_share_pct }}%）</span>
			</div>
			<div class="ddx__kpi">
				<span class="ddx__kpi-num">{{ (summary.total_patients || 0).toLocaleString() }}</span>
				<span class="ddx__kpi-lab">中毒患者人次</span>
			</div>
			<div class="ddx__kpi">
				<span class="ddx__kpi-num" :class="{ 'ddx__kpi-num--hi': summary.total_deaths > 0 }">{{ summary.total_deaths }}</span>
				<span class="ddx__kpi-lab">死亡數</span>
			</div>
		</div>

		<!-- 病原列表 + 件數 bar -->
		<div class="ddx__bars">
			<div
				v-for="p in items"
				:key="p.pathogen"
				class="ddx__bar-row"
				:class="{ 'ddx__bar-row--active': p.pathogen === selected }"
				@click="pickPathogen(p.pathogen)"
			>
				<span class="ddx__name">{{ p.pathogen }}</span>
				<div class="ddx__bar-track">
					<div
						class="ddx__bar-fill"
						:style="{ width: (p.case_count / maxCases * 100) + '%' }"
					/>
				</div>
				<span class="ddx__count">{{ p.case_count }}<span class="ddx__pct"> · {{ p.case_share_pct }}%</span></span>
				<span class="ddx__sev" :class="`ddx__sev--${p.severity_level}`">{{ SEV_LABEL[p.severity_level] }}</span>
			</div>
		</div>

		<!-- 詳細卡（依選中病原） -->
		<div v-if="selectedItem" class="ddx__detail">
			<div class="ddx__detail-head">
				<h3>{{ selectedItem.pathogen }}</h3>
				<span class="ddx__detail-meta">{{ selectedItem.main_symptom }}　·　潛伏期 {{ selectedItem.incubation_hr }}</span>
			</div>

			<div class="ddx__detail-row">
				<span class="ddx__detail-key">關聯食材</span>
				<div class="ddx__chips">
					<span v-for="f in selectedItem.related_foods" :key="f" class="ddx__chip">{{ f }}</span>
				</div>
			</div>

			<div class="ddx__detail-row">
				<span class="ddx__detail-key">典型場所</span>
				<span class="ddx__detail-val">{{ selectedItem.typical_settings }}</span>
			</div>

			<div class="ddx__detail-row">
				<span class="ddx__detail-key">處置策略</span>
				<span class="ddx__detail-val">{{ selectedItem.action_strategy }}</span>
			</div>

			<div class="ddx__detail-row">
				<span class="ddx__detail-key">檢驗方向</span>
				<span class="ddx__detail-val ddx__detail-val--em">{{ selectedItem.test_direction }}</span>
			</div>

			<div v-if="selectedItem.notes" class="ddx__notes">
				{{ selectedItem.notes }}
			</div>
		</div>
	</div>
</template>

<style scoped lang="scss">
.ddx {
	font-family: "微軟正黑體", "Microsoft JhengHei", sans-serif;
	color: var(--color-normal-text);
	font-size: var(--font-s);
	padding: 4px 8px 8px;
	display: flex; flex-direction: column; gap: 12px;
}
.ddx__lineage {
	font-size: 10px;
	padding: 4px 8px;
	background: rgba(245, 173, 74, 0.08);
	color: var(--color-complement-text);
	border: 1px dashed var(--color-border);
	border-radius: 3px;
	cursor: help;
	&--real {
		background: rgba(86, 185, 109, 0.08);
		color: var(--color-highlight);
		border: 1px solid var(--color-highlight);
		border-style: solid;
	}
}

.ddx__kpis {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 6px;
}
.ddx__kpi {
	background: rgba(0, 0, 0, 0.18);
	border: 1px solid var(--color-border);
	border-radius: 4px;
	padding: 8px 10px;
	display: flex; flex-direction: column; gap: 2px;
}
.ddx__kpi-num {
	font-size: 22px; font-weight: 700; line-height: 1;
	color: var(--color-normal-text);
	&--hi { color: var(--color-highlight); }
}
.ddx__kpi-lab { font-size: 10px; color: var(--color-complement-text); }

/* 病原條形列表 */
.ddx__bars { display: flex; flex-direction: column; gap: 4px; }
.ddx__bar-row {
	display: grid;
	grid-template-columns: 110px 1fr 80px 32px;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	border-radius: 4px;
	cursor: pointer;
	transition: background 0.15s;
	&:hover { background: rgba(255, 255, 255, 0.04); }
	&--active {
		background: rgba(90, 156, 248, 0.10);
		border-left: 2px solid var(--color-highlight);
		padding-left: 6px;
	}
}
.ddx__name { font-size: 12px; font-weight: 600; }
.ddx__bar-track {
	height: 6px;
	background: var(--color-border);
	border-radius: 3px;
	overflow: hidden;
}
.ddx__bar-fill {
	height: 100%;
	background: var(--color-complement-text);
	border-radius: 3px;
	transition: width 0.4s;
}
.ddx__bar-row--active .ddx__bar-fill {
	background: var(--color-highlight);
}
.ddx__count {
	font-size: 11px;
	font-variant-numeric: tabular-nums;
	color: var(--color-complement-text);
	text-align: right;
}
.ddx__pct { font-size: 9px; opacity: 0.6; }
.ddx__sev {
	font-size: 10px;
	font-weight: 600;
	text-align: center;
	padding: 1px 4px;
	border-radius: 3px;
	border: 1px solid;
	&--high { color: var(--color-highlight); border-color: var(--color-highlight); }
	&--medium { color: var(--color-complement-text); border-color: var(--color-complement-text); }
	&--low { color: var(--color-complement-text); border-color: var(--color-border); }
}

/* 詳細卡 */
.ddx__detail {
	background: rgba(0, 0, 0, 0.18);
	border: 1px solid var(--color-border);
	border-left: 3px solid var(--color-highlight);
	border-radius: 4px;
	padding: 12px 14px;
	display: flex; flex-direction: column; gap: 10px;
}
.ddx__detail-head {
	display: flex; flex-direction: column; gap: 2px;
	padding-bottom: 6px;
	border-bottom: 1px dashed var(--color-border);
	h3 {
		margin: 0; font-size: 15px; font-weight: 700;
		color: var(--color-normal-text);
	}
}
.ddx__detail-meta { font-size: 11px; color: var(--color-complement-text); }
.ddx__detail-row {
	display: grid;
	grid-template-columns: 70px 1fr;
	gap: 8px;
	font-size: 12px;
	line-height: 1.5;
}
.ddx__detail-key {
	color: var(--color-complement-text);
	font-weight: 500;
}
.ddx__detail-val { color: var(--color-normal-text); }
.ddx__detail-val--em { color: var(--color-highlight); font-weight: 500; }

.ddx__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.ddx__chip {
	font-size: 11px;
	padding: 2px 8px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.05);
	border: 1px solid var(--color-border);
	color: var(--color-normal-text);
}

.ddx__notes {
	font-size: 11px;
	color: var(--color-complement-text);
	font-style: italic;
	padding-top: 4px;
	border-top: 1px dashed var(--color-border);
}
</style>
