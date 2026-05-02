<!-- Component 1 — 衛生局建議稽查 Top 30（決策清單） -->
<script setup>
import { ref, computed, onMounted } from "vue";
import { loadFoodInspection } from "../../store/foodInspectionData";

const props = defineProps([
	"chart_config", "activeChart", "series", "map_config", "map_filter", "map_filter_on",
]);

const payload = ref(null);
const filterCity = ref("metrotaipei");  // 建議稽查清單預設雙北（看跨城市排行）
const filterType = ref("all");

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

const all = computed(() => payload.value?.suggested_inspections ?? []);

const cityTabs = computed(() => {
	const list = all.value;
	const tpe = list.filter(s => s.city === "臺北市").length;
	const ntc = list.filter(s => s.city === "新北市").length;
	return [
		{ key: "metrotaipei", label: `雙北 (${list.length})` },
		{ key: "taipei", label: `臺北市 (${tpe})` },
		{ key: "newtaipei", label: `新北市 (${ntc})` },
	];
});

const filtered = computed(() => {
	let list = all.value;
	if (filterCity.value === "taipei") list = list.filter(s => s.city === "臺北市");
	else if (filterCity.value === "newtaipei") list = list.filter(s => s.city === "新北市");
	if (filterType.value === "recidivist") list = list.filter(s => s.action_type.includes("累犯"));
	else if (filterType.value === "high_risk_sample") list = list.filter(s => s.action_type.includes("高風險食材"));
	return list;
});

const counts = computed(() => ({
	total: all.value.length,
	recidivist: all.value.filter(s => s.action_type.includes("累犯")).length,
	high_risk: all.value.filter(s => s.action_type.includes("高風險食材")).length,
}));
</script>

<template>
	<div v-if="activeChart === 'FoodSafetyInspectionListChart' && payload" class="ilist">
		<!-- 篩選列 -->
		<div class="ilist__filters">
			<div class="ilist__filter-group">
				<button
					v-for="t in cityTabs" :key="t.key"
					class="city-tab" :class="{ 'city-tab--active': filterCity === t.key }"
					@click="filterCity = t.key"
				>{{ t.label }}</button>
			</div>
			<div class="ilist__filter-group">
				<button class="city-tab" :class="{ 'city-tab--active': filterType === 'all' }" @click="filterType = 'all'">
					全部 {{ counts.total }}
				</button>
				<button class="city-tab" :class="{ 'city-tab--active': filterType === 'recidivist' }" @click="filterType = 'recidivist'">
					🔴 累犯 {{ counts.recidivist }}
				</button>
				<button class="city-tab" :class="{ 'city-tab--active': filterType === 'high_risk_sample' }" @click="filterType = 'high_risk_sample'">
					⚠️ 高風險 {{ counts.high_risk }}
				</button>
			</div>
		</div>

		<!-- 提示說明 -->
		<div class="ilist__hint">
			衛生局決策依據：累犯次數 × 違規嚴重度 × 跨區擴散；數字越高越優先稽查
		</div>

		<!-- 主清單 -->
		<table class="ilist__table">
			<thead>
				<tr>
					<th class="num">#</th>
					<th>類型</th>
					<th>店家 / 業者</th>
					<th>所在區</th>
					<th>主因</th>
					<th class="num">分數</th>
					<th>建議</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="s in filtered" :key="s.rank + '-' + s.store_name" class="ilist__row" :class="{ 'ilist__row--top': s.rank <= 5 }">
					<td class="num rank">{{ s.rank }}</td>
					<td>
						<span class="action-tag" :class="s.action_type.includes('累犯') ? 'action-tag--recidivist' : 'action-tag--sample'">
							{{ s.action_type.includes("累犯") ? "累犯" : "高風險" }}
						</span>
					</td>
					<td class="name" :title="s.address">{{ s.store_name }}</td>
					<td class="dist">
						<span class="city-pill" :class="s.city === '臺北市' ? 'city-pill--tpe' : s.city === '新北市' ? 'city-pill--ntc' : 'city-pill--unk'">
							{{ s.city === '臺北市' ? '北' : s.city === '新北市' ? '新' : '?' }}
						</span>
						{{ s.districts.length > 0 ? s.districts[0] : '—' }}
					</td>
					<td>
						<span class="vtype-pill" :style="{
							background: VIOLATION_COLOR[s.main_violation_type] + '33',
							color: VIOLATION_COLOR[s.main_violation_type],
							borderColor: VIOLATION_COLOR[s.main_violation_type]
						}">
							{{ s.main_violation_type }}
						</span>
					</td>
					<td class="num score">{{ s.action_score.toFixed(0) }}</td>
					<td class="suggest" :title="s.suggestion">{{ s.suggestion }}</td>
				</tr>
				<tr v-if="filtered.length === 0">
					<td class="empty" colspan="7">此篩選條件無建議稽查項目</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<style scoped lang="scss">
.ilist {
	font-family: "微軟正黑體", "Microsoft JhengHei", sans-serif;
	color: var(--color-normal-text);
	font-size: var(--font-s);
	padding: 4px 8px 8px;

	&__filters {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 6px;
	}
	&__filter-group {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	&__hint {
		font-size: 10px;
		color: var(--color-complement-text);
		padding: 4px 8px;
		background: rgba(245, 173, 74, 0.08);
		border-left: 2px solid #f5ad4a;
		margin-bottom: 6px;
	}
	&__table {
		width: 100%;
		border-collapse: collapse;
		font-size: 11px;
		th {
			text-align: left;
			font-weight: 500;
			color: var(--color-complement-text);
			padding: 5px 6px;
			border-bottom: 1px solid var(--color-border);
			white-space: nowrap;
			&.num { text-align: right; }
		}
		td {
			padding: 4px 6px;
			border-bottom: 1px solid rgba(255, 255, 255, 0.04);
			&.num { text-align: right; font-variant-numeric: tabular-nums; }
			&.score { font-weight: 600; color: #f5ad4a; }
			&.rank { color: var(--color-complement-text); font-weight: 600; }
			&.name { font-weight: 500; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			&.dist { white-space: nowrap; }
			&.suggest { color: var(--color-complement-text); font-size: 10px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			&.empty { text-align: center; color: var(--color-complement-text); padding: 20px; }
		}
	}
	&__row--top {
		td.rank {
			color: #E0413A;
			font-weight: 700;
		}
	}
}

.city-tab {
	background: rgba(255,255,255,0.06); color: var(--color-complement-text); border: 1px solid var(--color-border);
	padding: 3px 10px; border-radius: 10px; font-size: 10px; cursor: pointer; font-family: inherit;
	transition: all .15s;
	&:hover { background: rgba(255,255,255,0.12); color: var(--color-normal-text); }
	&--active { background: #f5ad4a; color: #11182a; border-color: #f5ad4a; font-weight: 600; }
}
.action-tag {
	display: inline-block;
	padding: 1px 6px;
	border-radius: 8px;
	font-size: 10px;
	font-weight: 600;
	&--recidivist { background: rgba(224, 65, 58, 0.18); color: #E0413A; border: 1px solid #E0413A; }
	&--sample { background: rgba(245, 173, 74, 0.18); color: #F5AD4A; border: 1px solid #F5AD4A; }
}
.city-pill {
	display: inline-block;
	width: 16px; height: 16px;
	font-size: 9px;
	line-height: 16px;
	text-align: center;
	border-radius: 50%;
	margin-right: 4px;
	&--tpe { background: #1E88E5; color: white; }
	&--ntc { background: #56B96D; color: white; }
	&--unk { background: #555; color: white; }
}
.vtype-pill {
	display: inline-block;
	padding: 1px 5px;
	border-radius: 7px;
	font-size: 9px;
	font-weight: 500;
	border: 1px solid;
	white-space: nowrap;
}
</style>
