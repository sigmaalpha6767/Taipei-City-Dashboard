<script setup>
import { ref, computed, onMounted } from "vue";
import { loadFoodInspection } from "../../store/foodInspectionData";

// 標準 chart props 契約
const props = defineProps([
	"chart_config",
	"activeChart",
	"series",
	"map_config",
	"map_filter",
	"map_filter_on",
]);

const payload = ref(null);
const loading = ref(true);
const error = ref(null);
const tab = ref("category");  // category | district

async function load() {
	try {
		loading.value = true;
		payload.value = await loadFoodInspection();
	} catch (e) {
		error.value = e.message || String(e);
	} finally {
		loading.value = false;
	}
}

onMounted(load);

const meta = computed(() => payload.value?.metadata ?? null);
const summary = computed(() => payload.value?.summary ?? null);
const categories = computed(() => payload.value?.categories ?? []);
const districts = computed(() => payload.value?.districts ?? []);
const violations = computed(() => payload.value?.violations ?? []);

const riskLabel = { red: "高", orange: "中高", yellow: "注意", green: "低" };
const violationColor = {
	"重金屬": "#7B1FA2",
	"農藥殘留": "#E0413A",
	"微生物": "#F08740",
	"動物用藥": "#FF7043",
	"防腐劑與添加物": "#FFB300",
	"標示不符": "#1E88E5",
	"其他": "#56B96D",
};

const maxFailCount = computed(() => Math.max(1, ...categories.value.map(c => c.fail_count)));
const maxDistFail = computed(() => Math.max(1, ...districts.value.map(d => d.fail_count)));

const recentViolations = computed(() => {
	return [...violations.value]
		.filter(v => v.test_date)
		.sort((a, b) => b.test_date.localeCompare(a.test_date))
		.slice(0, 30);
});
</script>

<template>
	<div
		v-if="activeChart === 'FoodSafetyRiskInspection'"
		class="risk"
	>
		<div v-if="loading" class="risk__state">資料載入中…</div>
		<div v-else-if="error" class="risk__state risk__state--error">載入失敗：{{ error }}</div>

		<template v-else>
			<!-- KPI -->
			<div v-if="summary" class="risk__kpis">
				<div class="risk__kpi">
					<span class="risk__kpi-label">總不合格件數</span>
					<span class="risk__kpi-value">{{ summary.total_fail_count }}</span>
				</div>
				<div class="risk__kpi">
					<span class="risk__kpi-label">高風險類別</span>
					<span class="risk__kpi-value">{{ summary.high_risk_category_count }}</span>
				</div>
				<div class="risk__kpi">
					<span class="risk__kpi-label">涉及行政區</span>
					<span class="risk__kpi-value">{{ summary.involved_district_count }}</span>
				</div>
				<div class="risk__kpi">
					<span class="risk__kpi-label">資料期間</span>
					<span class="risk__kpi-value risk__kpi-value--small">
						{{ summary.earliest_date?.slice(5) }}~{{ summary.latest_date?.slice(5) }}
					</span>
				</div>
			</div>

			<!-- 違規類別分布 (KPI 列下方一排小條) -->
			<div v-if="summary?.violation_type_breakdown" class="risk__breakdown">
				<span class="risk__breakdown-label">違規類別：</span>
				<span
					v-for="(count, type) in summary.violation_type_breakdown"
					:key="type"
					class="risk__type-pill"
					:style="{ background: violationColor[type] + '33', color: violationColor[type], borderColor: violationColor[type] }"
				>
					{{ type }} {{ count }}
				</span>
			</div>

			<!-- Tab 切換 -->
			<div class="risk__tabs">
				<button
					class="risk__tab"
					:class="{ 'risk__tab--active': tab === 'category' }"
					@click="tab = 'category'"
				>食品類別風險</button>
				<button
					class="risk__tab"
					:class="{ 'risk__tab--active': tab === 'district' }"
					@click="tab = 'district'"
				>行政區風險</button>
				<button
					class="risk__tab"
					:class="{ 'risk__tab--active': tab === 'recent' }"
					@click="tab = 'recent'"
				>最近不合格清單</button>
			</div>

			<!-- 食品類別風險（最重要） -->
			<div v-if="tab === 'category'" class="risk__section">
				<table class="risk__table">
					<thead>
						<tr>
							<th>食材類別</th>
							<th class="num">件數</th>
							<th>主要違規</th>
							<th class="num">涉及區</th>
							<th class="num">分數</th>
							<th>等級</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="c in categories" :key="c.category">
							<td class="name">{{ c.category }}</td>
							<td class="num">
								<div class="risk__bar-cell">
									<span>{{ c.fail_count }}</span>
									<span class="risk__bar">
										<span
											class="risk__bar-fill"
											:class="`risk__bar-fill--${c.risk_level}`"
											:style="{ width: (c.fail_count / maxFailCount * 100) + '%' }"
										/>
									</span>
								</div>
							</td>
							<td>
								<span
									class="risk__type-pill"
									:style="{ background: violationColor[c.main_violation_type] + '33', color: violationColor[c.main_violation_type], borderColor: violationColor[c.main_violation_type] }"
								>
									{{ c.main_violation_type }}
								</span>
							</td>
							<td class="num">{{ c.involved_district_count }}</td>
							<td class="num score">{{ c.risk_score.toFixed(1) }}</td>
							<td>
								<span class="risk__risk" :class="`risk__risk--${c.risk_level}`">
									{{ riskLabel[c.risk_level] }}
								</span>
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<!-- 行政區風險 -->
			<div v-else-if="tab === 'district'" class="risk__section">
				<table class="risk__table">
					<thead>
						<tr>
							<th>行政區</th>
							<th class="num">不合格件數</th>
							<th class="num">違規類別數</th>
							<th>主要違規</th>
							<th class="num">分數</th>
							<th>等級</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="d in districts" :key="d.district">
							<td class="name">{{ d.district }}</td>
							<td class="num">
								<div class="risk__bar-cell">
									<span>{{ d.fail_count }}</span>
									<span class="risk__bar">
										<span
											class="risk__bar-fill"
											:class="`risk__bar-fill--${d.risk_level}`"
											:style="{ width: (d.fail_count / maxDistFail * 100) + '%' }"
										/>
									</span>
								</div>
							</td>
							<td class="num">{{ d.violation_categories_count }}</td>
							<td>
								<span
									class="risk__type-pill"
									:style="{ background: violationColor[d.main_violation_type] + '33', color: violationColor[d.main_violation_type], borderColor: violationColor[d.main_violation_type] }"
								>
									{{ d.main_violation_type }}
								</span>
							</td>
							<td class="num score">{{ d.risk_score.toFixed(1) }}</td>
							<td>
								<span class="risk__risk" :class="`risk__risk--${d.risk_level}`">
									{{ riskLabel[d.risk_level] }}
								</span>
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<!-- 最近不合格清單 -->
			<div v-else-if="tab === 'recent'" class="risk__section">
				<table class="risk__table">
					<thead>
						<tr>
							<th>抽驗日期</th>
							<th>檢體</th>
							<th>分類</th>
							<th>店家</th>
							<th>行政區</th>
							<th>違規類別</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="v in recentViolations" :key="v.violation_id">
							<td class="num">{{ v.test_date }}</td>
							<td class="name" :title="v.reason_summary">{{ v.sample_name }}</td>
							<td>{{ v.category }}</td>
							<td class="store" :title="v.address">{{ v.store_name }}</td>
							<td>{{ v.district }}</td>
							<td>
								<span
									class="risk__type-pill"
									:style="{ background: violationColor[v.violation_type] + '33', color: violationColor[v.violation_type], borderColor: violationColor[v.violation_type] }"
								>
									{{ v.violation_type }}
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
.risk {
	font-family: "微軟正黑體", "Microsoft JhengHei", sans-serif;
	color: var(--color-normal-text);
	font-size: var(--font-s);
	padding: 4px 8px 8px;
}

.risk__state {
	padding: 40px;
	text-align: center;
	color: var(--color-complement-text);
	&--error { color: #e0413a; }
}

/* KPIs */
.risk__kpis {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 6px;
	margin-bottom: 8px;
}
.risk__kpi {
	background: rgba(0, 0, 0, 0.18);
	border-radius: 4px;
	padding: 6px 8px;
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.risk__kpi-label { font-size: 10px; color: var(--color-complement-text); }
.risk__kpi-value {
	font-size: 22px;
	font-weight: 700;
	color: #f5ad4a;
	line-height: 1;
	&--small { font-size: 12px; font-weight: 500; }
}

/* breakdown pills */
.risk__breakdown {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
	align-items: center;
	margin-bottom: 8px;
	padding: 6px 8px;
	background: rgba(0, 0, 0, 0.12);
	border-radius: 4px;
}
.risk__breakdown-label {
	font-size: 10px;
	color: var(--color-complement-text);
}

/* tabs */
.risk__tabs {
	display: flex;
	gap: 2px;
	margin-bottom: 6px;
	border-bottom: 1px solid var(--color-border);
}
.risk__tab {
	background: transparent;
	border: none;
	color: var(--color-complement-text);
	padding: 6px 10px;
	font-size: 11px;
	cursor: pointer;
	border-bottom: 2px solid transparent;
	transition: all 0.15s;
	font-family: inherit;
	&:hover { color: var(--color-normal-text); }
	&--active {
		color: #f5ad4a;
		border-bottom-color: #f5ad4a;
		font-weight: 600;
	}
}

/* type pill (shared) */
.risk__type-pill {
	display: inline-block;
	padding: 1px 6px;
	border-radius: 8px;
	font-size: 10px;
	font-weight: 500;
	border: 1px solid;
	white-space: nowrap;
}

/* table */
.risk__section { margin-bottom: 4px; }
.risk__table {
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
		padding: 5px 6px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
		&.num { text-align: right; font-variant-numeric: tabular-nums; }
		&.score { font-weight: 600; color: #f5ad4a; }
		&.name { font-weight: 500; }
		&.store { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	}
}

/* bar inside cell */
.risk__bar-cell {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 2px;
}
.risk__bar {
	width: 60px;
	height: 3px;
	background: rgba(255, 255, 255, 0.06);
	border-radius: 2px;
	overflow: hidden;
}
.risk__bar-fill {
	display: block;
	height: 100%;
	border-radius: 2px;
	&--red { background: #e0413a; }
	&--orange { background: #f08740; }
	&--yellow { background: #f2c94c; }
	&--green { background: #56b96d; }
}

/* risk level badge */
.risk__risk {
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
</style>
