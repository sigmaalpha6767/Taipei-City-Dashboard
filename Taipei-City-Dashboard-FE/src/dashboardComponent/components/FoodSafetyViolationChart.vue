<!-- Component 1 — 違規類別占比（圓環，雙北切換） -->
<script setup>
import { ref, computed, onMounted } from "vue";
import VueApexCharts from "vue3-apexcharts";
import { loadFoodInspection } from "../../store/foodInspectionData";

const props = defineProps([
	"chart_config", "activeChart", "series", "map_config", "map_filter", "map_filter_on",
]);

const payload = ref(null);
const activeCityKey = ref("metrotaipei");
async function load() {
	try {
		payload.value = await loadFoodInspection();
	} catch (e) { /* silent */ }
}
onMounted(load);

const VIOLATION_COLOR = {
	"重金屬": "#7B1FA2", "農藥殘留": "#E0413A", "微生物": "#F08740",
	"動物用藥": "#FF7043", "防腐劑與添加物": "#FFB300", "標示不符": "#1E88E5", "其他": "#56B96D",
};
const cityTabs = [
	{ key: "metrotaipei", label: "雙北" },
	{ key: "taipei", label: "臺北市" },
	{ key: "newtaipei", label: "新北市" },
];

const breakdown = computed(() => payload.value?.cities?.[activeCityKey.value]?.summary?.violation_type_breakdown ?? {});
const entries = computed(() => Object.entries(breakdown.value).sort((a, b) => b[1] - a[1]));
const apexSeries = computed(() => entries.value.map(([_, v]) => v));
const apexLabels = computed(() => entries.value.map(([k]) => k));
const apexColors = computed(() => entries.value.map(([k]) => VIOLATION_COLOR[k] || "#56B96D"));
const total = computed(() => apexSeries.value.reduce((a, b) => a + b, 0));

const chartOptions = computed(() => ({
	chart: { offsetY: 10 },
	colors: apexColors.value,
	dataLabels: {
		formatter: function (_val, { seriesIndex, w }) {
			const value = w.globals.labels[seriesIndex];
			return value.length > 6 ? value.slice(0, 5) + "…" : value;
		},
	},
	labels: apexLabels.value,
	legend: { show: false },
	plotOptions: { pie: { dataLabels: { offset: 15 }, donut: { size: "72%" } } },
	stroke: { colors: ["#282a2c"], show: true, width: 3 },
	tooltip: {
		followCursor: false,
		custom: function ({ series, seriesIndex, w }) {
			const sum = series.reduce((a, b) => a + b, 0);
			const pct = ((series[seriesIndex] / sum) * 100).toFixed(1);
			return '<div class="chart-tooltip">' +
				`<h6>${w.globals.labels[seriesIndex]}</h6>` +
				`<span>${series[seriesIndex]} 件（${pct}%）</span>` +
				"</div>";
		},
	},
}));
</script>

<template>
	<div v-if="activeChart === 'FoodSafetyViolationChart' && payload" class="violation-donut">
		<div class="city-tabs">
			<button
				v-for="t in cityTabs" :key="t.key"
				class="city-tab" :class="{ 'city-tab--active': activeCityKey === t.key }"
				@click="activeCityKey = t.key"
			>{{ t.label }}</button>
		</div>
		<VueApexCharts width="100%" type="donut" :options="chartOptions" :series="apexSeries" />
		<div class="violation-donut__title">
			<h5>不合格</h5>
			<h6>{{ total }}</h6>
		</div>
	</div>
</template>

<style scoped lang="scss">
.violation-donut {
	height: 100%; width: 100%; display: flex; flex-direction: column;
	justify-content: center; align-items: center; position: relative; overflow-y: visible;
	&__title {
		display: flex; align-items: center; justify-content: center; flex-direction: column; position: absolute;
		top: 50%; transform: translateY(-30%);
		h5 { margin: 0; color: var(--color-complement-text); font-size: var(--font-s); font-weight: 400; }
		h6 { margin: 0; color: var(--color-complement-text); font-size: var(--font-m); font-weight: 600; }
	}
}
.city-tabs {
	display: flex; gap: 4px; justify-content: flex-end; padding: 0 4px;
	width: 100%;
	z-index: 5;
}
.city-tab {
	background: rgba(255,255,255,0.06); color: var(--color-complement-text); border: 1px solid var(--color-border);
	padding: 2px 10px; border-radius: 10px; font-size: 10px; cursor: pointer; font-family: inherit;
	transition: all .15s;
	&:hover { background: rgba(255,255,255,0.12); color: var(--color-normal-text); }
	&--active { background: #f5ad4a; color: #11182a; border-color: #f5ad4a; font-weight: 600; }
}
</style>
