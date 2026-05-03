<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { loadFoodExposure } from "../../store/foodInspectionData";

const props = defineProps([
	"chart_config",
	"activeChart",
	"series",
	"map_config",
	"map_filter",
	"map_filter_on",
]);

// 資料即時從 postgres-data 取（BE /food/exposure 聚合 vulnerable_facility_exposure +
// district_exposure_summary + food_event_current 三張表，不再讀靜態 JSON）
const payload = ref(null);
const loading = ref(true);
const error = ref(null);

const activeCity = computed(() => props.map_config?.[0]?.city || "");

async function load() {
	try {
		loading.value = true;
		payload.value = await loadFoodExposure({ city: activeCity.value });
	} catch (e) {
		error.value = e.message || String(e);
	} finally {
		loading.value = false;
	}
}
onMounted(load);
watch(activeCity, load);

const event = computed(() => payload.value?.event ?? null);
const summary = computed(() => payload.value?.summary ?? null);

function pctEvent(p) {
	return `${(p * 100).toFixed(0)}%`;
}
</script>

<template>
	<div v-if="activeChart === 'FoodSafetyVulnerableExposure'" class="vexp">
		<div v-if="loading" class="vexp__state">資料載入中…</div>
		<div v-else-if="error" class="vexp__state vexp__state--error">載入失敗：{{ error }}</div>

		<template v-else>
			<!-- 事件資訊（4 column header）-->
			<div v-if="event" class="vexp__event">
				<div class="vexp__event-cell">
					<span class="vexp__label">疑似原料</span>
					<span class="vexp__value vexp__value--em">{{ event.suspected_ingredient }}</span>
				</div>
				<div class="vexp__event-cell">
					<span class="vexp__label">疑似供應商</span>
					<span class="vexp__value">{{ event.suspected_supplier_name }}</span>
				</div>
				<div class="vexp__event-cell">
					<span class="vexp__label">風險類型</span>
					<span class="vexp__value">{{ event.risk_type }}</span>
				</div>
				<div class="vexp__event-cell">
					<span class="vexp__label">機率</span>
					<span class="vexp__value vexp__value--em">{{ pctEvent(event.probability) }}</span>
				</div>
			</div>

			<!-- 4 格 KPI（國中小 / 幼兒園 / 長照 / 高暴露行政區）-->
			<div v-if="summary" class="vexp__quad">
				<div class="vexp__quad-cell">
					<div class="vexp__quad-label">受影響國中小</div>
					<div class="vexp__quad-value">
						{{ summary.affected_school_count }}<span class="vexp__quad-unit">所</span>
					</div>
				</div>
				<div class="vexp__quad-cell">
					<div class="vexp__quad-label">受影響幼兒園</div>
					<div class="vexp__quad-value">
						{{ summary.affected_kindergarten_count }}<span class="vexp__quad-unit">所</span>
					</div>
				</div>
				<div class="vexp__quad-cell">
					<div class="vexp__quad-label">受影響長照機構</div>
					<div class="vexp__quad-value">
						{{ summary.affected_care_count }}<span class="vexp__quad-unit">家</span>
					</div>
				</div>
				<div class="vexp__quad-cell">
					<div class="vexp__quad-label">高暴露行政區</div>
					<div class="vexp__quad-value">
						{{ summary.high_exposure_district_count }}<span class="vexp__quad-unit">區</span>
					</div>
				</div>
			</div>
		</template>
	</div>
</template>

<style scoped lang="scss">
.vexp {
	font-family: "微軟正黑體", "Microsoft JhengHei", sans-serif;
	color: var(--color-normal-text);
	font-size: var(--font-s);
	padding: 4px 8px 8px;
}

.vexp__state {
	padding: 40px;
	text-align: center;
	color: var(--color-complement-text);
	&--error { color: var(--color-highlight); }
}

/* 事件 header */
.vexp__event {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 8px;
	padding: 10px 12px;
	background: rgba(0, 0, 0, 0.18);
	border: 1px solid var(--color-border);
	border-radius: 4px;
	margin-bottom: 12px;
}
.vexp__event-cell {
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.vexp__label {
	font-size: 10px;
	color: var(--color-complement-text);
}
.vexp__value {
	font-size: 13px;
	color: var(--color-normal-text);
	font-weight: 500;
}
.vexp__value--em {
	color: var(--color-highlight);
	font-weight: 700;
}

/* 4 格簡潔 KPI（仿長照指標 quadrant） */
.vexp__quad {
	display: grid;
	grid-template-columns: 1fr 1fr;
	grid-template-rows: 1fr 1fr;
	min-height: 220px;
}
.vexp__quad-cell {
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: center;
	gap: 8px;
	padding: 16px;
	border-right: 1px solid var(--color-border);
	border-bottom: 1px solid var(--color-border);

	&:nth-child(2n) { border-right: none; }
	&:nth-child(n+3) { border-bottom: none; }
}
.vexp__quad-label {
	font-size: 13px;
	color: var(--color-complement-text);
	letter-spacing: 0.04em;
}
.vexp__quad-value {
	font-size: 36px;
	font-weight: 700;
	color: var(--color-highlight);
	line-height: 1;
	display: flex;
	align-items: baseline;
	gap: 4px;
}
.vexp__quad-unit {
	font-size: 14px;
	font-weight: 500;
	color: var(--color-complement-text);
}
</style>
