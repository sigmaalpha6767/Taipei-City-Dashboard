<script setup>
import { ref, computed, onMounted } from "vue";
import { loadFoodExposure } from "../../store/foodInspectionData";

// 標準 chart props 契約（依 DashboardComponent.vue dispatch）
const props = defineProps([
	"chart_config",
	"activeChart",
	"series",
	"map_config",
	"map_filter",
	"map_filter_on",
]);

// 資料即時從 postgres-data 取（BE /food/exposure 聚合 vulnerable_facility_exposure +
// district_exposure_summary + food_event_current 三張表）
const payload = ref(null);
const loading = ref(true);
const error = ref(null);

async function load() {
	try {
		loading.value = true;
		payload.value = await loadFoodExposure();
	} catch (e) {
		error.value = e.message || String(e);
	} finally {
		loading.value = false;
	}
}

onMounted(load);

// --- derived ---------------------------------------------------------
const event = computed(() => payload.value?.event ?? null);
const summary = computed(() => payload.value?.summary ?? null);
const districts = computed(() => payload.value?.districts ?? []);
const facilities = computed(() => payload.value?.facilities ?? []);

const riskLabel = { red: "高", orange: "中高", yellow: "注意", green: "低" };
const facilityTypeLabel = {
	school: "學校",
	kindergarten: "幼兒園",
	care: "長照",
	elderly_home: "老福",
	nursing_home: "護理",
};

const maxDistrictPop = computed(() =>
	Math.max(1, ...districts.value.map((d) => d.estimated_exposed_population))
);

function pct(n) {
	return `${(n * 100).toFixed(1)}%`;
}

function pctEvent(p) {
	return `${(p * 100).toFixed(0)}%`;
}
</script>

<template>
	<div
		v-if="activeChart === 'FoodSafetyVulnerableExposure'"
		class="vexp"
	>
		<div v-if="loading" class="vexp__state">資料載入中…</div>
		<div v-else-if="error" class="vexp__state vexp__state--error">
			載入失敗：{{ error }}
		</div>

		<template v-else>
			<!-- 事件資訊 -->
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

			<!-- KPI -->
			<div v-if="summary" class="vexp__kpis">
				<div class="vexp__kpi">
					<span class="vexp__kpi-label">受影響學校</span>
					<span class="vexp__kpi-value">{{ summary.affected_school_count }}</span>
				</div>
				<div class="vexp__kpi">
					<span class="vexp__kpi-label">受影響幼兒園</span>
					<span class="vexp__kpi-value">{{ summary.affected_kindergarten_count }}</span>
				</div>
				<div class="vexp__kpi">
					<span class="vexp__kpi-label">受影響長照</span>
					<span class="vexp__kpi-value">{{ summary.affected_care_count }}</span>
				</div>
				<div class="vexp__kpi">
					<span class="vexp__kpi-label">高暴露區</span>
					<span class="vexp__kpi-value">{{ summary.high_exposure_district_count }}</span>
				</div>
			</div>

			<!-- 行政區排行 -->
			<div class="vexp__section">
				<div class="vexp__section-title">行政區暴露排行</div>
				<table class="vexp__table">
					<thead>
						<tr>
							<th>行政區</th>
							<th class="num">學校</th>
							<th class="num">幼兒園</th>
							<th class="num">長照</th>
							<th class="num">高齡</th>
							<th class="num">暴露</th>
							<th class="num">分數</th>
							<th>等級</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="d in districts" :key="d.district">
							<td><span class="vexp__city">{{ d.city }}</span>{{ d.district }}</td>
							<td class="num">{{ d.affected_school_count }}</td>
							<td class="num">{{ d.affected_kindergarten_count }}</td>
							<td class="num">{{ d.affected_care_count }}</td>
							<td class="num">{{ pct(d.elderly_ratio) }}</td>
							<td class="num">
								<div class="vexp__bar-cell">
									<span>{{ d.estimated_exposed_population.toLocaleString() }}</span>
									<span class="vexp__bar">
										<span
											class="vexp__bar-fill"
											:class="`vexp__bar-fill--${d.risk_level}`"
											:style="{ width: (d.estimated_exposed_population / maxDistrictPop * 100) + '%' }"
										/>
									</span>
								</div>
							</td>
							<td class="num score">{{ d.exposure_score.toFixed(1) }}</td>
							<td>
								<span class="vexp__risk" :class="`vexp__risk--${d.risk_level}`">
									{{ riskLabel[d.risk_level] }}
								</span>
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<!-- 受影響場域清單 -->
			<div class="vexp__section">
				<div class="vexp__section-title">受影響場域清單（依分數排序）</div>
				<table class="vexp__table">
					<thead>
						<tr>
							<th>場域</th>
							<th>類型</th>
							<th>行政區</th>
							<th>關聯</th>
							<th class="num">人口</th>
							<th class="num">分數</th>
							<th>等級</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="f in facilities" :key="f.facility_id">
							<td class="name">{{ f.facility_name }}</td>
							<td>
								<span class="vexp__type" :class="`vexp__type--${f.facility_type}`">
									{{ facilityTypeLabel[f.facility_type] }}
								</span>
							</td>
							<td>{{ f.district }}</td>
							<td>
								<div class="vexp__rel">{{ f.relation_type }}</div>
								<div class="vexp__rel-detail" v-if="f.related_ingredient">{{ f.related_ingredient }}</div>
							</td>
							<td class="num">{{ f.exposure_population.toLocaleString() }}</td>
							<td class="num score">{{ f.exposure_score.toFixed(1) }}</td>
							<td>
								<span class="vexp__risk" :class="`vexp__risk--${f.risk_level}`">
									{{ riskLabel[f.risk_level] }}
								</span>
							</td>
						</tr>
					</tbody>
				</table>
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
	&--error { color: #e0413a; }
}

.vexp__label {
	font-size: 10px;
	color: var(--color-complement-text);
	margin-right: 4px;
}
.vexp__value { color: var(--color-normal-text); }
.vexp__value--em { color: #f5ad4a; font-weight: 600; }

/* event */
.vexp__event {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 8px;
	padding: 8px 10px;
	background: rgba(0, 0, 0, 0.18);
	border-radius: 4px;
	margin-bottom: 8px;
	font-size: 11px;
}
.vexp__event-cell {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

/* KPIs */
.vexp__kpis {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 6px;
	margin-bottom: 10px;
}
.vexp__kpi {
	background: rgba(0, 0, 0, 0.18);
	border-radius: 4px;
	padding: 6px 8px;
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.vexp__kpi-label { font-size: 10px; color: var(--color-complement-text); }
.vexp__kpi-value {
	font-size: 22px;
	font-weight: 700;
	color: #f5ad4a;
	line-height: 1;
}

/* sections + tables */
.vexp__section { margin-bottom: 8px; }
.vexp__section-title {
	font-size: 11px;
	color: var(--color-complement-text);
	padding: 4px 0;
	border-bottom: 1px solid var(--color-border);
	margin-bottom: 4px;
}
.vexp__table {
	width: 100%;
	border-collapse: collapse;
	font-size: 11px;

	th {
		text-align: left;
		font-weight: 500;
		color: var(--color-complement-text);
		padding: 6px 6px;
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
		&.num { text-align: right; }
	}
	td {
		padding: 6px 6px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
		&.num { text-align: right; font-variant-numeric: tabular-nums; }
		&.score { font-weight: 600; color: #f5ad4a; }
		&.name { font-weight: 500; }
	}
	tr:last-child td { border-bottom: none; }
}

.vexp__city {
	display: inline-block;
	font-size: 9px;
	color: var(--color-complement-text);
	background: rgba(0, 0, 0, 0.25);
	padding: 0 4px;
	border-radius: 2px;
	margin-right: 4px;
}

/* bar inside cell */
.vexp__bar-cell {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 2px;
}
.vexp__bar {
	width: 60px;
	height: 3px;
	background: rgba(255, 255, 255, 0.06);
	border-radius: 2px;
	overflow: hidden;
}
.vexp__bar-fill {
	display: block;
	height: 100%;
	border-radius: 2px;
	transition: width 0.3s;
	&--red { background: #e0413a; }
	&--orange { background: #f08740; }
	&--yellow { background: #f2c94c; }
	&--green { background: #56b96d; }
}

/* risk badge */
.vexp__risk {
	display: inline-block;
	padding: 1px 6px;
	border-radius: 8px;
	font-size: 10px;
	font-weight: 600;
	&--red { background: rgba(224, 65, 58, 0.18); color: #e0413a; border: 1px solid #e0413a; }
	&--orange { background: rgba(240, 135, 64, 0.18); color: #f08740; border: 1px solid #f08740; }
	&--yellow { background: rgba(242, 201, 76, 0.18); color: #f2c94c; border: 1px solid #f2c94c; }
	&--green { background: rgba(86, 185, 109, 0.18); color: #56b96d; border: 1px solid #56b96d; }
}

/* type pill */
.vexp__type {
	display: inline-block;
	padding: 1px 5px;
	border-radius: 3px;
	font-size: 10px;
	&--school { background: rgba(86, 193, 240, 0.18); color: #56c1f0; }
	&--kindergarten { background: rgba(245, 173, 74, 0.18); color: #f5ad4a; }
	&--care { background: rgba(86, 185, 109, 0.18); color: #56b96d; }
	&--elderly_home { background: rgba(240, 135, 64, 0.18); color: #f08740; }
	&--nursing_home { background: rgba(201, 112, 224, 0.18); color: #c970e0; }
}

.vexp__rel { font-weight: 500; font-size: 10px; }
.vexp__rel-detail { font-size: 9px; color: var(--color-complement-text); margin-top: 1px; }
</style>
