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

// 直接讀 geojson — 全集長照機構,跟地圖圖層同源,不依事件影響範圍
const facilities = ref([]);
const loading = ref(true);
const error = ref(null);

async function load() {
	try {
		loading.value = true;
		const resp = await axios.get("/mapData/vulnerable_facility_care.geojson");
		facilities.value = (resp.data?.features || []).map((ft) => ({
			...ft.properties,
		}));
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
	if (!target) return facilities.value; // metrotaipei 全集
	return facilities.value.filter((f) => f.city === target);
});

const totalCount = computed(() => filtered.value.length);
const districtCount = computed(
	() => new Set(filtered.value.map((f) => f.district).filter(Boolean)).size,
);
const totalCapacity = computed(() =>
	filtered.value.reduce((acc, f) => acc + (f.population_or_capacity || 0), 0),
);
const avgCapacity = computed(() =>
	totalCount.value ? Math.round(totalCapacity.value / totalCount.value) : 0,
);

function fmt(n) { return (n ?? 0).toLocaleString(); }

// 把 activeCity 套到地圖 layer 上(mapbox setFilter)
// taipei → 只顯示臺北市;newtaipei → 只顯示新北市;metrotaipei → 不過濾
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
// 監聽 city 切換 + layer 加入/移除(以 currentLayers 長度為簡易訊號)
watch(
	() => [activeCity.value, mapStore.currentLayers.length],
	() => applyMapCityFilter(),
	{ flush: "post" },
);
</script>

<template>
	<div v-if="activeChart === 'FoodSafetyCareExposure'" class="cexp">
		<div v-if="loading" class="cexp__state">資料載入中…</div>
		<div v-else-if="error" class="cexp__state cexp__state--error">載入失敗：{{ error }}</div>

		<template v-else>
			<div class="cexp__quad">
				<div class="cexp__quad-cell">
					<div class="cexp__quad-label">長照機構</div>
					<div class="cexp__quad-value">{{ totalCount }}<span class="cexp__quad-unit">家</span></div>
				</div>
				<div class="cexp__quad-cell">
					<div class="cexp__quad-label">涉及行政區</div>
					<div class="cexp__quad-value">{{ districtCount }}<span class="cexp__quad-unit">區</span></div>
				</div>
				<div class="cexp__quad-cell">
					<div class="cexp__quad-label">總床位</div>
					<div class="cexp__quad-value">{{ fmt(totalCapacity) }}<span class="cexp__quad-unit">床</span></div>
				</div>
				<div class="cexp__quad-cell">
					<div class="cexp__quad-label">平均規模</div>
					<div class="cexp__quad-value">{{ avgCapacity }}<span class="cexp__quad-unit">床/家</span></div>
				</div>
			</div>
		</template>
	</div>
</template>

<style scoped lang="scss">
.cexp {
	font-family: "微軟正黑體", "Microsoft JhengHei", sans-serif;
	color: var(--color-normal-text);
	font-size: var(--font-s);
	padding: 4px 8px 8px;
}
.cexp__state {
	padding: 40px;
	text-align: center;
	color: var(--color-complement-text);
	&--error { color: var(--color-highlight); }
}
.cexp__quad {
	display: grid;
	grid-template-columns: 1fr 1fr;
	grid-template-rows: 1fr 1fr;
	min-height: 220px;
}
.cexp__quad-cell {
	display: flex; flex-direction: column; justify-content: center; align-items: center;
	gap: 8px; padding: 16px;
	border-right: 1px solid var(--color-border);
	border-bottom: 1px solid var(--color-border);
	&:nth-child(2n) { border-right: none; }
	&:nth-child(n+3) { border-bottom: none; }
}
.cexp__quad-label { font-size: 13px; color: var(--color-complement-text); letter-spacing: 0.04em; }
.cexp__quad-value {
	font-size: 36px; font-weight: 700; color: var(--color-highlight); line-height: 1;
	display: flex; align-items: baseline; gap: 4px;
}
.cexp__quad-unit { font-size: 14px; font-weight: 500; color: var(--color-complement-text); }
</style>
