// 食安 AI 應變中樞 store — 走 BE 正規 tool registry 路徑
//   FE → POST /api/dev/v1/ai/chat/twai (BE wrapper, JWT auth)
//   BE → 註冊 4 個 Go tool（food_safety.go） + 多輪 tool calling 迴圈 + ai_chatlog 寫入
import { defineStore } from "pinia";
import http from "../router/axios";
import { loadFoodInspection, loadFoodExposure, loadFoodDiseaseStats } from "./foodInspectionData";

const TOOLS = [
	{
		type: "function",
		function: {
			name: "get_food_risk_summary",
			description: "取得本期雙北食安抽驗的核心摘要：總件數、Top 高頻食材、行政區排行、違規類別分布。沒有參數。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "get_top_recidivists",
			description: "取得多次違規累犯場域清單（含店家、校園、供應商）。回傳場域名稱、違規次數、城市、主要違規類別、相關食材。",
			parameters: {
				type: "object",
				properties: { limit: { type: "integer", description: "取前幾名（預設 5）" } },
				required: [],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_vulnerable_exposure",
			description: "取得目前事件對校園與長照機構的影響範圍：受影響學校數、幼兒園數、長照機構數、估計暴露人口、事件相關供應商與食材。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "get_district_risk",
			description: "取得指定城市的行政區風險排行。",
			parameters: {
				type: "object",
				properties: {
					city: { type: "string", enum: ["taipei", "newtaipei", "metrotaipei"], description: "查詢城市，預設 metrotaipei" },
					limit: { type: "integer", description: "取前幾區（預設 5）" },
				},
				required: [],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_disease_stats",
			description: "取得衛福部食藥署 (TFDA) 民國 112 年全國食品中毒病因物質統計，回傳 12 種病原（諾羅、沙門氏菌、腸炎弧菌、金黃色葡萄球菌、仙人掌桿菌、大腸桿菌、組織胺、植物性、河豚毒、輪狀、肉毒、不明）的件數、患者數、死亡數、相關食材、典型場所、處置策略、檢驗方向、潛伏期、症狀。當使用者問群聚事件可能病原、症狀反推食材、檢驗優先順序、消毒策略時呼叫。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
];

export const useAiAdvisorStore = defineStore("aiAdvisor", {
	state: () => ({
		mode: "live",
		demoData: null,
		foodInspection: null,
		vulnerableExposure: null,
		diseaseStats: null,
		// 進階卡片：醫療應變 / 食品供應鏈 / 學校溯源（從 component chart endpoint 動態彙整）
		hospitalsSummary: null,
		supplyTraceSummary: null,
		schoolTraceSummary: null,
		roleResponses: {},
		activeRole: null,
		docResponses: {},
		activeDoc: null,
		// 決策視角：gov = 政府端（衛生局/教育局…），citizen = 市民端（家長/外食族…）
		audience: "gov",
	}),

	getters: {
		// 依當前 audience 動態回傳角色與模板列表，view 不需要再判斷
		aiRoles: (state) => {
			const list = state.audience === "citizen"
				? state.demoData?.citizen_roles
				: state.demoData?.ai_roles;
			return list ?? [];
		},
		docTemplates: (state) => {
			const list = state.audience === "citizen"
				? state.demoData?.citizen_templates
				: state.demoData?.doc_templates;
			return list ?? [];
		},
		// 全角色合集（角色按鈕高亮、generate 找 system_prompt 時用）
		allRoles: (state) => [
			...(state.demoData?.ai_roles ?? []),
			...(state.demoData?.citizen_roles ?? []),
		],
		allTemplates: (state) => [
			...(state.demoData?.doc_templates ?? []),
			...(state.demoData?.citizen_templates ?? []),
		],
		chatSuggestions: (state) => state.demoData?.chat_suggestions ?? [],
		// metadata 走「demo 預設 → 被即時 DB 覆蓋」策略：
		// title/subtitle 維持 demo 設定，data_period / data_sources / data_total 從 BE summary 即時來
		metadata: (state) => {
			const demo = state.demoData?.metadata ?? {};
			const live = state.foodInspection?.metadata ?? {};
			const liveSummary = state.foodInspection?.summary ?? {};
			const merged = { ...demo };
			if (live.data_total != null) merged.data_total = live.data_total;
			if (live.data_period) merged.data_period = live.data_period;
			if (liveSummary.earliest_date && liveSummary.latest_date) {
				merged.data_period = `${liveSummary.earliest_date} ~ ${liveSummary.latest_date}`;
			}
			if (live.data_real != null || live.data_mock != null) {
				merged.data_sources = [];
				if (live.data_real > 0) {
					merged.data_sources.push({ name: "真實抽驗清冊", type: "real", count: live.data_real });
				}
				if (live.data_mock > 0) {
					merged.data_sources.push({ name: "模擬資料", type: "mock", count: live.data_mock });
				}
			}
			return merged;
		},

		eventSummary: (state) => {
			const d = state.foodInspection;
			if (!d) return null;
			const samples = d.samples || [];
			const districts = d.districts || [];
			const recidivists = d.recidivists || [];
			return {
				total: d.summary?.total_fail_count ?? 0,
				// 字串格式（給舊 KPI 條等保留）
				topSamples: samples.slice(0, 3).map(s => `${s.sample_name} ${s.fail_count}件`),
				topDistricts: districts.slice(0, 3).map(x => `${x.district} ${x.fail_count}`),
				topRecidivists: recidivists.slice(0, 3).map(r => `${r.store_name}（${r.fail_count}次）`),
				// 原始陣列（給視覺化卡片用）
				samplesRaw: samples,
				districtsRaw: districts,
				recidivistsRaw: recidivists,
				violationBreakdown: d.summary?.violation_type_breakdown ?? {},
				dateRange: { start: d.summary?.earliest_date, end: d.summary?.latest_date },
			};
		},

		// Component 6: 病因物質判定 — 給「事件 → 病因 → 食材 → 處置」決策段
		diseaseSummary: (state) => {
			const d = state.diseaseStats;
			if (!d) return null;
			const items = d.items || [];
			// 排除「不明」單獨呈現
			const known = items.filter((x) => x.pathogen_type !== "unknown" && x.pathogen !== "病因物質不明");
			const unknown = items.find((x) => x.pathogen_type === "unknown" || x.pathogen === "病因物質不明");
			return {
				summary: d.summary || {},
				metadata: d.metadata || {},
				topPathogens: known.slice(0, 5),
				allPathogens: known,
				unknown,
				totalCases: d.summary?.total_cases ?? 0,
				totalPatients: d.summary?.total_patients ?? 0,
				totalDeaths: d.summary?.total_deaths ?? 0,
				identifiedShare: d.summary?.identified_share_pct ?? 0,
				dataYear: d.metadata?.data_year ?? null,
				isReal: d.metadata?.data_kind === "real",
			};
		},

		propagationSummary: (state) => {
			const v = state.vulnerableExposure;
			if (!v) return null;
			const facilities = (v.facilities || []);
			return {
				totalFacilities: facilities.length, // 受影響場域總數（從 facilities 陣列即時算）
				affectedSchools: v.summary?.affected_school_count ?? 0,
				affectedKindergartens: v.summary?.affected_kindergarten_count ?? 0,
				affectedCare: v.summary?.affected_care_count ?? 0,
				affectedDistricts: (v.districts || []).length,
				highExposureDistricts: v.summary?.high_exposure_district_count ?? 0,
				estimatedExposed: v.summary?.estimated_exposed_population ?? 0,
				event: v.event,
			};
		},
	},

	actions: {
		async init() {
			try {
				const module = await import("../views/aiAdvisor/demo_outputs.json");
				this.demoData = module.default;
			} catch (e) { /* silent */ }
			try {
				// 從 postgres-data 走 BE 端點，取代原本的靜態 JSON
				this.foodInspection = await loadFoodInspection();
			} catch (e) { /* silent */ }
			try {
				// 脆弱場域暴露：postgres-data → BE /food/exposure（5 張表 join）
				this.vulnerableExposure = await loadFoodExposure();
			} catch (e) { /* silent */ }
			try {
				// 食源性疾病統計：postgres-data → BE /food/disease-stats (TFDA 民國 112 全國)
				this.diseaseStats = await loadFoodDiseaseStats();
			} catch (e) { /* silent */ }
			// 進階卡片：醫療應變 + 食品供應鏈 + 學校溯源
			this.hospitalsSummary = await this._loadComponentSummary(1, "metrotaipei");
			this.supplyTraceSummary = await this._loadComponentSummary(500, "metrotaipei");
			this.schoolTraceSummary = await this._loadComponentSummary(501, "metrotaipei");
		},

		// 從 BE component chart endpoint 取一個 three_d 圖的 categories + series，
		// 算出每個 series 的 total / 各 category total / top 3 category。
		async _loadComponentSummary(componentId, city) {
			try {
				const resp = await http.get(`/component/${componentId}/chart`, { params: { city } });
				// BE 端把 {categories, data} 直接放在 axios resp.data 頂層（不再多包一層）
				const payload = resp?.data ?? {};
				const categories = payload.categories ?? [];
				const series = payload.data ?? [];
				const seriesTotals = series.map((s) => ({
					name: s.name,
					total: (s.data || []).reduce((a, b) => a + (Number(b) || 0), 0),
				}));
				const grandTotal = seriesTotals.reduce((a, b) => a + b.total, 0);
				const categoryTotals = categories.map((cat, i) => ({
					name: cat,
					total: series.reduce((a, s) => a + (Number(s.data?.[i]) || 0), 0),
				}));
				const topCategories = [...categoryTotals]
					.filter((c) => c.total > 0)
					.sort((a, b) => b.total - a.total)
					.slice(0, 5);
				return { categories, series: seriesTotals, grandTotal, topCategories };
			} catch (e) {
				return null;
			}
		},

		// === 透過 BE wrapper 呼叫 TWCC + 真 tool registry ===
		async callBE(messages, onToolCalls, onContent) {
			const t0 = performance.now();

			// BE 期待參數：messages / tools / tool_choice / max_new_tokens / temperature / stream
			const body = {
				messages,
				tools: TOOLS,
				tool_choice: "auto",
				max_new_tokens: 600,
				temperature: 0.4,
				stream: false,
			};

			const resp = await http.post("/ai/chat/twai", body);
			const data = resp.data?.data ?? {};
			const content = data.content ?? "";
			const usage = data.usage;
			const toolsRaw = data.tools;  // BE 回傳：JSON string of executed tool names
			let executedTools = [];
			if (typeof toolsRaw === "string" && toolsRaw && toolsRaw !== "null") {
				try { executedTools = JSON.parse(toolsRaw); } catch (e) { /* ignore */ }
			} else if (Array.isArray(toolsRaw)) {
				executedTools = toolsRaw;
			}

			// 模擬 inline tool call 顯示（依執行順序逐一加入）
			if (executedTools.length && onToolCalls) {
				for (let i = 0; i < executedTools.length; i++) {
					await new Promise(r => setTimeout(r, 200));
					onToolCalls({
						id: `be-${i}`,
						name: executedTools[i],
						args: "{}",
						status: "running",
					});
					await new Promise(r => setTimeout(r, 250));
					onToolCalls({
						id: `be-${i}`,
						name: executedTools[i],
						args: "{}",
						status: "done",
						ms: Math.round((performance.now() - t0) / executedTools.length),
					});
				}
			}

			// 打字機效果輸出最終 content
			if (onContent) await this.typewriter(content, onContent);

			return { content, usage, executedTools };
		},

		typewriter(text, onChunk, charsPerTick = 5, intervalMs = 14) {
			return new Promise(resolve => {
				let pos = 0;
				const tick = () => {
					pos = Math.min(pos + charsPerTick, text.length);
					onChunk(text.slice(pos - charsPerTick, pos));
					if (pos < text.length) setTimeout(tick, intervalMs);
					else resolve();
				};
				tick();
			});
		},

		setAudience(value) {
			if (value !== "gov" && value !== "citizen") return;
			if (this.audience === value) return;
			this.audience = value;
			// 切換視角時清掉當前選取，避免 UI 殘留另一邊的角色/公文
			this.activeRole = null;
			this.activeDoc = null;
		},

		// === AI 角色行動建議（走 BE） ===
		async generateRoleAction(roleId) {
			const role = this.allRoles.find(r => r.id === roleId);
			if (!role) return;
			this.activeRole = roleId;
			this.roleResponses[roleId] = { content: "", streaming: true, toolCalls: [], usage: null };

			const systemContent = `${role.system_prompt}

你可呼叫以下工具取得即時資料：
- get_food_risk_summary: 食安事件摘要 (本期雙北抽驗)
- get_top_recidivists: 累犯場域清單（含店家 / 校園 / 供應商）
- get_vulnerable_exposure: 校園長照影響範圍
- get_district_risk: 行政區風險排行
- get_disease_stats: 食源性疾病病原統計 (TFDA 民國 112 年全國，含病原 → 食材 → 處置 → 檢驗 對照)

決策時請依角色取用工具：
- 衛生局 / 醫療端：症狀群聚 → get_disease_stats 反推可能病原與檢驗方向
- 教育局 / 家長：高風險食材 → get_disease_stats 看病原關聯食材
- 社會局 / 長照照顧者：諾羅 / 沙門特別注意校園 / 長照群聚

請主動呼叫工具取得資料後，給出可執行行動建議。回答簡潔（≤200 字），引用具體數字。`;

			const userPrompt = `請給出 ${role.label} 視角下，本期最重要的 3 個行動建議。每項含具體對象、動作、理由，引用具體數字。`;

			try {
				const result = await this.callBE(
					[
						{ role: "system", content: systemContent },
						{ role: "user", content: userPrompt },
					],
					(tc) => {
						const target = this.roleResponses[roleId].toolCalls;
						const idx = target.findIndex(x => x.id === tc.id);
						if (idx >= 0) target[idx] = tc;
						else target.push(tc);
					},
					(chunk) => { this.roleResponses[roleId].content += chunk; },
				);
				this.roleResponses[roleId].streaming = false;
				this.roleResponses[roleId].usage = result.usage;
			} catch (e) {
				const msg = e.response?.data?.message || e.message || String(e);
				this.roleResponses[roleId].content = `[BE 失敗] ${msg}`;
				this.roleResponses[roleId].streaming = false;
			}
		},

		async generateDoc(docId) {
			const doc = this.allTemplates.find(d => d.id === docId);
			if (!doc) return;
			this.activeDoc = docId;
			this.docResponses[docId] = { content: "", streaming: true, toolCalls: [] };

			const outputKind = doc.doc_type === "citizen_card" ? "市民行動卡片" : "公文/通知";
			const systemContent = `${doc.system_prompt}

你可呼叫工具取得即時資料：get_food_risk_summary / get_top_recidivists / get_vulnerable_exposure / get_district_risk / get_disease_stats。請先呼叫必要工具（含病原統計，如有需要對應症狀/食材/處置/檢驗方向），再依資料生成${outputKind}。`;

			const userPrompt = doc.doc_type === "citizen_card"
				? "請依資料生成市民行動卡片，嚴格遵守 system prompt 中的 markdown 結構。語氣親切、實用。"
				: "請依資料生成公文/通知草稿。風格符合公部門用語、條理清楚。";

			try {
				await this.callBE(
					[
						{ role: "system", content: systemContent },
						{ role: "user", content: userPrompt },
					],
					(tc) => {
						const target = this.docResponses[docId].toolCalls;
						const idx = target.findIndex(x => x.id === tc.id);
						if (idx >= 0) target[idx] = tc;
						else target.push(tc);
					},
					(chunk) => { this.docResponses[docId].content += chunk; },
				);
				this.docResponses[docId].streaming = false;
			} catch (e) {
				const msg = e.response?.data?.message || e.message || String(e);
				this.docResponses[docId].content = `[BE 失敗] ${msg}`;
				this.docResponses[docId].streaming = false;
			}
		},

		// 對話功能已搬到全站「臺北城市儀表板小幫手」(chatStore + ChatBox.vue)，這裡只保留角色 / 公文。

		clearAll() {
			this.roleResponses = {};
			this.docResponses = {};
			this.activeRole = null;
			this.activeDoc = null;
		},
	},
});
