<!-- Component 1 — 高風險檢體 Top 10（矩形圖） -->
<script setup>
import { ref, computed, onMounted } from "vue";
import VueApexCharts from "vue3-apexcharts";
import { loadFoodInspection } from "../../store/foodInspectionData";

const props = defineProps([
	"chart_config", "activeChart", "activeCity", "series",
	"map_config", "map_filter", "map_filter_on",
]);

const payload = ref(null);
async function load() {
	try {
		payload.value = await loadFoodInspection();
	} catch (e) { /* silent */ }
}
onMounted(load);

const TOP_N = 10;

// 紅色梯度：深→淺對應排名
const RANK_COLORS = [
	"#8B0000", "#B71C1C", "#C62828", "#D32F2F", "#E0413A",
	"#E64A47", "#F08740", "#F4A261", "#F2C94C", "#F5DD83",
];

// 對齊專案標準：用 props.activeCity（由 DashboardComponent 上方 dropdown 控制）
const activeCityKey = computed(() => props.activeCity || "metrotaipei");

const samples = computed(() => payload.value?.cities?.[activeCityKey.value]?.samples ?? []);
const top10 = computed(() => samples.value.slice(0, TOP_N));

const apexSeries = computed(() => [{
	data: top10.value.map(s => ({
		x: `${s.sample_name}（${s.fail_count}件）`,
		y: s.fail_count,
	})),
}]);

const distributedColors = computed(() =>
	top10.value.map((_, i) => RANK_COLORS[i] || "#999")
);

const top10Sum = computed(() => top10.value.reduce((acc, s) => acc + s.fail_count, 0));
const totalSum = computed(() => samples.value.reduce((acc, s) => acc + s.fail_count, 0));
const top10Pct = computed(() => totalSum.value > 0 ? (top10Sum.value / totalSum.value * 100).toFixed(0) : 0);

const chartOptions = computed(() => ({
	chart: { borderRadius: 5, toolbar: { show: false } },
	colors: distributedColors.value,
	dataLabels: {
		enabled: true,
		style: { fontSize: "13px", fontWeight: 600, colors: ["#fff"] },
	},
	grid: { show: false },
	legend: { show: false },
	plotOptions: {
		treemap: { distributed: true, shadeIntensity: 0, useFillColorAsStroke: false },
	},
	stroke: { colors: ["#282a2c"], show: true, width: 2 },
	tooltip: {
		custom: function ({ dataPointIndex }) {
			const s = top10.value[dataPointIndex];
			if (!s) return "";
			return '<div class="chart-tooltip">' +
				`<h6>${s.sample_name}</h6>` +
				`<span>${s.fail_count} 件不合格</span><br/>` +
				`<span style="font-size:11px;color:#ccc">主要違規：${s.main_violation_type}</span><br/>` +
				`<span style="font-size:11px;color:#ccc">涉及 ${s.districts.length} 個行政區</span>` +
				"</div>";
		},
	},
	xaxis: {
		axisBorder: { show: false },
		axisTicks: { show: false },
		labels: { show: false },
		type: "category",
	},
}));
</script>

<template>
	<div v-if="activeChart === 'FoodSafetyCategoryChart' && payload" class="treemapchart">
		<div class="treemapchart-title">
			<h5>高風險食材 Top {{ top10.length }}</h5>
			<h6>{{ top10Sum }} 件 / 占全市 {{ top10Pct }}%</h6>
		</div>
		<VueApexCharts width="100%" type="treemap" :options="chartOptions" :series="apexSeries" />
	</div>
</template>

<style scoped lang="scss">
.treemapchart {
	&-title {
		display: flex; justify-content: center; flex-direction: column; margin: 0.5rem 0 -0.5rem;
		h5 { margin: 0; color: var(--color-complement-text); }
		h6 { margin: 0; color: var(--color-complement-text); font-size: var(--font-m); font-weight: 400; }
	}
}
</style>
