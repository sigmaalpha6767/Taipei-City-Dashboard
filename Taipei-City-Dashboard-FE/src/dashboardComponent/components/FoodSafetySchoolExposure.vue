<script setup>
import { computed, onMounted, ref, watch } from "vue";
import axios from "axios";
import { useMapStore } from "../../store/mapStore";

const props = defineProps([
	"chart_config",
	"activeChart",
	"series",
	"map_config",
	"map_filter",
	"map_filter_on",
]);

const mapStore = useMapStore();

// 直接讀 geojson(school + kindergarten) — 全集校園,跟地圖圖層同源
const facilities = ref([]);
const loading = ref(true);
const error = ref(null);

async function load() {
	try {
		loading.value = true;
		const [schoolResp, kinResp] = await Promise.all([
			axios.get("/mapData/vulnerable_facility_school.geojson"),
			axios.get("/mapData/vulnerable_facility_kindergarten.geojson"),
		]);
		const fromGeojson = (resp) =>
			(resp.data?.features || []).map((ft) => ({ ...ft.properties }));
		facilities.value = [...fromGeojson(schoolResp), ...fromGeojson(kinResp)];
	} catch (e) {
		error.value = e.message || String(e);
	} finally {
		loading.value = false;
	}
}
onMounted(load);

// City 過濾:'taipei' → 只台北市;'newtaipei' → 只新北市;'metrotaipei'(雙北) → 全集
const activeCity = computed(() => props.map_config?.[0]?.city || "metrotaipei");
const cityToCh = { taipei: "臺北市", newtaipei: "新北市" };

const filtered = computed(() => {
	const target = cityToCh[activeCity.value];
	if (!target) return facilities.value;
	return facilities.value.filter((f) => f.city === target);
});

const schoolCount = computed(
	() => filtered.value.filter((f) => f.facility_type === "school").length,
);
const kindergartenCount = computed(
	() => filtered.value.filter((f) => f.facility_type === "kindergarten").length,
);
const districtCount = computed(
	() => new Set(filtered.value.map((f) => f.district).filter(Boolean)).size,
);
const totalCapacity = computed(() =>
	filtered.value.reduce((acc, f) => acc + (f.population_or_capacity || 0), 0),
);

function fmt(n) { return (n ?? 0).toLocaleString(); }

// 把 activeCity 套到地圖 layer 上(mapbox setFilter)
function applyMapCityFilter() {
	if (!mapStore.map) return;
	const target = cityToCh[activeCity.value];
	for (const mc of (props.map_config || [])) {
		const layerId = `${mc.index}-${mc.type}-${mc.city}`;
		if (mapStore.map.getLayer && mapStore.map.getLayer(layerId)) {
			try {
				if (target) {
					mapStore.map.setFilter(layerId, ["==", ["get", "city"], target]);
				} else {
					mapStore.map.setFilter(layerId, null);
				}
			} catch { /* layer 沒 city 屬性就忽略 */ }
		}
	}
}
onMounted(applyMapCityFilter);
watch(
	() => [activeCity.value, mapStore.currentLayers.length],
	() => applyMapCityFilter(),
	{ flush: "post" },
);
</script>

<template>
	<div v-if="activeChart === 'FoodSafetySchoolExposure'" class="vexp">
		<div v-if="loading" class="vexp__state">資料載入中…</div>
		<div v-else-if="error" class="vexp__state vexp__state--error">載入失敗：{{ error }}</div>

		<template v-else>
			<div class="vexp__quad">
				<div class="vexp__quad-cell">
					<div class="vexp__quad-label">國中小</div>
					<div class="vexp__quad-value">{{ schoolCount }}<span class="vexp__quad-unit">所</span></div>
				</div>
				<div class="vexp__quad-cell">
					<div class="vexp__quad-label">幼兒園</div>
					<div class="vexp__quad-value">{{ kindergartenCount }}<span class="vexp__quad-unit">所</span></div>
				</div>
				<div class="vexp__quad-cell">
					<div class="vexp__quad-label">涉及行政區</div>
					<div class="vexp__quad-value">{{ districtCount }}<span class="vexp__quad-unit">區</span></div>
				</div>
				<div class="vexp__quad-cell">
					<div class="vexp__quad-label">總學童名額</div>
					<div class="vexp__quad-value">{{ fmt(totalCapacity) }}<span class="vexp__quad-unit">人</span></div>
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
.vexp__quad {
	display: grid;
	grid-template-columns: 1fr 1fr;
	grid-template-rows: 1fr 1fr;
	min-height: 220px;
}
.vexp__quad-cell {
	display: flex; flex-direction: column; justify-content: center; align-items: center;
	gap: 8px; padding: 16px;
	border-right: 1px solid var(--color-border);
	border-bottom: 1px solid var(--color-border);
	&:nth-child(2n) { border-right: none; }
	&:nth-child(n+3) { border-bottom: none; }
}
.vexp__quad-label { font-size: 13px; color: var(--color-complement-text); letter-spacing: 0.04em; }
.vexp__quad-value {
	font-size: 36px; font-weight: 700; color: var(--color-highlight); line-height: 1;
	display: flex; align-items: baseline; gap: 4px;
}
.vexp__quad-unit { font-size: 14px; font-weight: 500; color: var(--color-complement-text); }
</style>
