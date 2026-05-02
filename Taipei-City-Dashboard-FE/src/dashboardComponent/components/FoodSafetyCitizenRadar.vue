<!-- Component 6 — 市民食安雷達（純儀表板，無互動輸入） -->
<script setup>
import { ref, computed, onMounted } from "vue";
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

// 對齊專案標準：用上方 dropdown 控制（不再用內部 pill）
const activeCityKey = computed(() => props.activeCity || "metrotaipei");
const cityData = computed(() => payload.value?.cities?.[activeCityKey.value] ?? {});

const topSamples = computed(() => (cityData.value.samples ?? []).slice(0, 5));
const topDistricts = computed(() => (cityData.value.districts ?? []).slice(0, 4));
const violationBreakdown = computed(() => cityData.value.summary?.violation_type_breakdown ?? {});

const VIOLATION_COLOR = {
	"重金屬": "#7B1FA2", "農藥殘留": "#E0413A", "微生物": "#F08740",
	"動物用藥": "#FF7043", "防腐劑與添加物": "#FFB300", "標示不符": "#1E88E5", "其他": "#56B96D",
};

// 動態生成市民提示（依資料情境）
const tips = computed(() => {
	const out = [];
	const sortedV = Object.entries(violationBreakdown.value).sort((a, b) => b[1] - a[1]);

	if (sortedV.length > 0) {
		const [topV] = sortedV[0];
		const tipMap = {
			"農藥殘留": { icon: "🥬", text: "葉菜類食用前以流動清水沖洗 5 分鐘可大幅降低農藥殘留" },
			"微生物": { icon: "🌡️", text: "購買後立即冷藏；食用前充分加熱可消除多數微生物風險" },
			"重金屬": { icon: "⚠️", text: "重金屬累積性高，建議分散採購來源、避免單一產地" },
			"動物用藥": { icon: "🍖", text: "肉品建議向有 CAS / 產銷履歷標章的店家購買" },
			"防腐劑與添加物": { icon: "🏷️", text: "包裝食品確認標示與保存期限；自製食品優於市售加工品" },
			"標示不符": { icon: "📋", text: "購買時注意產品標示是否完整、過敏原是否標明" },
		};
		out.push(tipMap[topV] ?? { icon: "💡", text: `主要違規為「${topV}」，留意食材來源` });
	}

	if (topDistricts.value.length > 0) {
		const top = topDistricts.value[0];
		out.push({
			icon: "📍",
			text: `${top.city}${top.district}近期不合格 ${top.fail_count} 件，建議優先確認當地小吃店家進貨來源`,
		});
	}

	if (topSamples.value.length > 0) {
		const names = topSamples.value.slice(0, 3).map(s => s.sample_name).join("、");
		out.push({
			icon: "🍽️",
			text: `近期 Top 高風險：${names}，建議向有 GAP / CAS / 產銷履歷標章的攤商購買`,
		});
	}

	return out;
});

const totalFail = computed(() => cityData.value.summary?.total_fail_count ?? 0);
</script>

<template>
	<div v-if="activeChart === 'FoodSafetyCitizenRadar' && payload" class="radar">
		<!-- Section 1: 本月避雷食材 Top 5 -->
		<section class="radar__section">
			<div class="radar__section-title">
				🚨 本月避雷食材 Top 5
				<span class="radar__section-meta">{{ totalFail }} 件不合格</span>
			</div>
			<div class="radar__list">
				<div v-for="(s, i) in topSamples" :key="s.sample_name" class="radar__row">
					<span class="radar__rank">{{ i + 1 }}</span>
					<span class="radar__name">{{ s.sample_name }}</span>
					<span class="radar__count">{{ s.fail_count }} 件</span>
					<span class="radar__vtype" :style="{
						background: VIOLATION_COLOR[s.main_violation_type] + '33',
						color: VIOLATION_COLOR[s.main_violation_type],
						borderColor: VIOLATION_COLOR[s.main_violation_type],
					}">{{ s.main_violation_type }}</span>
				</div>
			</div>
		</section>

		<!-- Section 2: 行政區紅榜 -->
		<section class="radar__section">
			<div class="radar__section-title">🗺️ 行政區紅榜</div>
			<div class="radar__list">
				<div v-for="d in topDistricts" :key="d.city + d.district" class="radar__row">
					<span class="radar__rank-pill" :class="`radar__rank-pill--${d.risk_level}`">
						{{ d.risk_level === 'red' ? '高' : d.risk_level === 'orange' ? '中高' : d.risk_level === 'yellow' ? '注意' : '低' }}
					</span>
					<span class="radar__name">{{ d.district }}</span>
					<span class="radar__count">{{ d.fail_count }} 件</span>
					<div class="radar__bar">
						<span class="radar__bar-fill" :class="`radar__bar-fill--${d.risk_level}`"
							:style="{ width: topDistricts[0]?.fail_count
								? (d.fail_count / topDistricts[0].fail_count * 100) + '%' : '0%' }" />
					</div>
				</div>
			</div>
		</section>

		<!-- Section 3: 市民避雷提示 -->
		<section class="radar__section">
			<div class="radar__section-title">💡 市民避雷提示</div>
			<div class="radar__tips">
				<div v-for="(t, i) in tips" :key="i" class="radar__tip">
					<span class="radar__tip-icon">{{ t.icon }}</span>
					<span class="radar__tip-text">{{ t.text }}</span>
				</div>
			</div>
		</section>
	</div>
</template>

<style scoped lang="scss">
.radar {
	font-family: "微軟正黑體", "Microsoft JhengHei", sans-serif;
	color: var(--color-normal-text);
	padding: 4px 8px;

	&__section {
		margin-bottom: 10px;
	}
	&__section-title {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 11px;
		color: var(--color-complement-text);
		margin-bottom: 6px;
		padding-bottom: 3px;
		border-bottom: 1px solid var(--color-border);
	}
	&__section-meta {
		font-size: 10px;
		color: #f5ad4a;
		font-weight: 600;
	}

	&__list {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	&__row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		background: rgba(0, 0, 0, 0.18);
		border-radius: 4px;
		font-size: 11px;
	}
	&__rank {
		color: var(--color-complement-text);
		font-weight: 700;
		min-width: 16px;
		font-variant-numeric: tabular-nums;
	}
	&__rank-pill {
		display: inline-block;
		min-width: 30px;
		padding: 1px 6px;
		text-align: center;
		border-radius: 8px;
		font-size: 10px;
		font-weight: 600;
		&--red { background: rgba(224, 65, 58, 0.18); color: #E0413A; border: 1px solid #E0413A; }
		&--orange { background: rgba(240, 135, 64, 0.18); color: #F08740; border: 1px solid #F08740; }
		&--yellow { background: rgba(242, 201, 76, 0.18); color: #F2C94C; border: 1px solid #F2C94C; }
		&--green { background: rgba(86, 185, 109, 0.18); color: #56B96D; border: 1px solid #56B96D; }
	}
	&__name {
		flex: 1;
		font-weight: 500;
	}
	&__count {
		color: #f5ad4a;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		min-width: 40px;
		text-align: right;
	}
	&__vtype {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 8px;
		font-size: 9px;
		font-weight: 500;
		border: 1px solid;
		white-space: nowrap;
	}

	&__bar {
		width: 80px;
		height: 4px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 2px;
		overflow: hidden;
	}
	&__bar-fill {
		display: block;
		height: 100%;
		border-radius: 2px;
		&--red { background: #E0413A; }
		&--orange { background: #F08740; }
		&--yellow { background: #F2C94C; }
		&--green { background: #56B96D; }
	}

	&__tips {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	&__tip {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 5px 8px;
		background: rgba(86, 193, 240, 0.06);
		border-left: 2px solid #56C1F0;
		border-radius: 0 3px 3px 0;
		font-size: 10px;
		line-height: 1.5;
	}
	&__tip-icon { font-size: 12px; flex-shrink: 0; }
	&__tip-text { color: var(--color-normal-text); }
}
</style>
