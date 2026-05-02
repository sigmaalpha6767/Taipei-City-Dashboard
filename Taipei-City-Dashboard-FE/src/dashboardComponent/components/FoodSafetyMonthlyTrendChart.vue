<!-- Component 1 — 月份趨勢（雙北雙線） -->
<script setup>
import { ref, computed, onMounted } from "vue";
import VueApexCharts from "vue3-apexcharts";
import { loadFoodInspection } from "../../store/foodInspectionData";

const props = defineProps([
	"chart_config", "activeChart", "series", "map_config", "map_filter", "map_filter_on",
]);

const payload = ref(null);
async function load() {
	try {
		payload.value = await loadFoodInspection();
	} catch (e) { /* silent */ }
}
onMounted(load);

const trend = computed(() => payload.value?.monthly_trend ?? { months: [], series: [] });

const apexSeries = computed(() => trend.value.series);

const chartOptions = computed(() => ({
	chart: {
		offsetY: 10,
		toolbar: { show: false },
		zoom: { enabled: false },
	},
	colors: ["#1E88E5", "#56B96D"],
	dataLabels: { enabled: false },
	stroke: { curve: "smooth", width: 3 },
	markers: { size: 4, strokeWidth: 2, hover: { size: 6 } },
	grid: {
		borderColor: "rgba(255,255,255,0.06)",
		strokeDashArray: 3,
		yaxis: { lines: { show: true } },
		xaxis: { lines: { show: false } },
	},
	legend: {
		show: true,
		position: "top",
		horizontalAlign: "right",
		labels: { colors: "var(--color-complement-text)" },
		markers: { width: 10, height: 10, radius: 5 },
		itemMargin: { horizontal: 10 },
	},
	tooltip: {
		shared: true,
		intersect: false,
		custom: function ({ series, dataPointIndex, w }) {
			const month = w.globals.labels[dataPointIndex];
			let content = '<div class="chart-tooltip">' +
				`<h6>${month}</h6>`;
			series.forEach((s, i) => {
				const name = w.globals.seriesNames[i];
				const color = w.globals.colors[i];
				content += `<span style="color:${color}">●</span> ${name}: <b>${s[dataPointIndex]} 件</b><br/>`;
			});
			content += "</div>";
			return content;
		},
	},
	xaxis: {
		categories: trend.value.months,
		labels: {
			style: { colors: "var(--color-complement-text)", fontSize: "10px" },
			rotate: -45,
		},
		axisBorder: { color: "rgba(255,255,255,0.1)" },
		axisTicks: { color: "rgba(255,255,255,0.1)" },
	},
	yaxis: {
		labels: { style: { colors: "var(--color-complement-text)", fontSize: "10px" } },
	},
}));

// 找出尖峰月份做說明
const peakMonth = computed(() => {
	if (!trend.value.series.length) return null;
	let peak = { month: "", count: 0, city: "" };
	trend.value.series.forEach(s => {
		s.data.forEach((v, i) => {
			if (v > peak.count) {
				peak = { month: trend.value.months[i], count: v, city: s.name };
			}
		});
	});
	return peak;
});
</script>

<template>
	<div v-if="activeChart === 'FoodSafetyMonthlyTrendChart' && payload" class="trendchart">
		<div class="trendchart__hint">
			📈 觀察季節性與長期趨勢；找出抽驗高峰月份做為下一輪重點時段
		</div>
		<VueApexCharts width="100%" height="280" type="line" :options="chartOptions" :series="apexSeries" />
		<div v-if="peakMonth" class="trendchart__peak">
			<span class="trendchart__peak-label">尖峰月：</span>
			<span class="trendchart__peak-value">{{ peakMonth.month }}（{{ peakMonth.city }} {{ peakMonth.count }} 件）</span>
		</div>
	</div>
</template>

<style scoped lang="scss">
.trendchart {
	&__hint {
		font-size: 10px;
		color: var(--color-complement-text);
		padding: 4px 8px;
		background: rgba(86, 193, 240, 0.08);
		border-left: 2px solid #56C1F0;
		margin-bottom: 4px;
	}
	&__peak {
		text-align: center;
		font-size: 11px;
		color: var(--color-complement-text);
		padding: 4px 0;
	}
	&__peak-label { color: var(--color-complement-text); }
	&__peak-value { color: #f5ad4a; font-weight: 600; }
}
</style>
