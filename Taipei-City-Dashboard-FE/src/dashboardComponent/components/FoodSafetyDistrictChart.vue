<!-- Component 1 — 行政區圖（複用既有 DistrictChart SVG 渲染） -->
<script setup>
import { ref, computed, onMounted } from "vue";
import DistrictChart from "./DistrictChart.vue";
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

// 對齊專案標準：props.activeCity 由 DashboardComponent 上方 dropdown 控制
const activeCityKey = computed(() => props.activeCity || "metrotaipei");

// 把 districts 聚合資料轉成 DistrictChart 期望的 2D series 格式
const districtSeries = computed(() => {
	const districts = payload.value?.cities?.[activeCityKey.value]?.districts ?? [];
	return [{
		name: "不合格件數",
		data: districts.map(d => ({ x: d.district, y: d.fail_count })),
	}];
});

const innerConfig = computed(() => ({
	...props.chart_config,
	color: ["#E0413A"],  // 紅色濃度 = 食安風險
	unit: "件",
}));
</script>

<template>
	<div v-if="activeChart === 'FoodSafetyDistrictChart' && payload">
		<DistrictChart
			active-chart="DistrictChart"
			:active-city="activeCityKey"
			:series="districtSeries"
			:chart_config="innerConfig"
			:map_config="map_config"
			:map_filter="map_filter"
			:map_filter_on="map_filter_on"
		/>
	</div>
</template>
