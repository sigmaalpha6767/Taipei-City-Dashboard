import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import http from "../router/axios";
import { useMapStore } from "./mapStore";
import { useContentStore } from "./contentStore";

// 與後端 /ai/chat/twai 的薄介接層 — 對齊官方 PDF「開發者只需定義 tools，AI 自動決定呼叫時機」契約。
// FE 不再做 topic 分流 / snapshot 注入 / 多 system prompt — 那些屬於 BE LLM/state machine 的職責。
// 我們只負責：(1) 串訊息送 BE，(2) 把回答顯示出來，(3) 若 LLM 呼叫了組件搜尋，再做一次向量查詢拼 UI 按鈕。

const TOOLS = [
	{
		type: "function",
		function: {
			name: "search_dashboard_components",
			description: "向量搜儀表板組件。問「有沒有 XX 組件」時呼叫。",
			parameters: {
				type: "object",
				properties: {
					query: { type: "string", description: "使用者想搜尋的主題描述" },
					limit: { type: "integer", description: "回傳前幾筆，預設 8" },
					score: { type: "number", description: "相似度門檻 0-1，預設 0.78" },
				},
				required: ["query"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_food_risk_summary",
			description: "雙北食安抽驗摘要(總件數、Top 違規食材、行政區排行)。問「最近食安」「哪些違規」時呼叫。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "get_top_recidivists",
			description: "累犯場域清單(店家/校園/供應商)。問「累犯」「該稽查的店」時呼叫。",
			parameters: {
				type: "object",
				properties: { limit: { type: "integer", description: "取前幾名，預設 5" } },
				required: [],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_vulnerable_exposure",
			description: "校園/長照暴露範圍。問「校園/長照受影響」時呼叫。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "get_district_risk",
			description: "行政區風險排行(依違規件數)。問特定區或行政區比較時呼叫。",
			parameters: {
				type: "object",
				properties: {
					city: { type: "string", enum: ["taipei", "newtaipei", "metrotaipei"], description: "查詢城市，預設 metrotaipei（雙北）" },
					limit: { type: "integer", description: "取前幾區，預設 5" },
				},
				required: [],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_disease_stats",
			description: "TFDA 112 年食品中毒病因統計(12 種病原+食材對照)。問「哪些食物高風險」「飲食建議」「症狀反推食材」時呼叫。回答時主體是食材。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "focus_dashboard_view",
			description: "UI 指令:把畫面切到指定組件 + 套 filter。可跟資料 tool 同回合呼叫。",
			parameters: {
				type: "object",
				properties: {
					component_index: {
						type: "string",
						description: "從 system prompt 載入清單挑,不可編造。",
					},
					city: {
						type: "string",
						enum: ["taipei", "newtaipei", "metrotaipei"],
					},
					filters: {
						type: "object",
						description: "如 {district: '新莊區'}",
					},
				},
				required: ["component_index"],
			},
		},
	},
];

// 極短 prompt — TWCC 16k context 很緊,長 prompt + 多 tool 結果累積會爆。
// 兩種 prompt:有 tool 用「分析師」版,沒 tool 用「快路徑」版(下方 sendChat 動態挑)。
const SYSTEM_PROMPT_WITH_TOOLS = `你是雙北食安決策分析師。
規則:
1. 數字、店名、食材、行政區只能引用 tool 結果,沒回的不准提(沒對應 tool 直接說「無資料 tool」)
2. 三段式:**觀察**(具體資料)/**推論**(風險集中)/**建議**(1-2 條 actionable)
3. 一次最多呼叫 1 個 tool,避免 context 爆掉
4. 200 字內。禁止「請持續關注」這類空話,禁止「根據結果」開場`;

const SYSTEM_PROMPT_NO_TOOLS = `你是雙北食安/儀表板小幫手。地圖已自動切到使用者要看的組件。
請用中文簡短回應使用者的問題,直接給觀察跟一條行動建議,合計三到五句話。
若使用者問的領域沒有對應資料,只要回「目前無此資料,請從地圖點位判讀位置即可」,千萬不要編造數字、店名、食材。`;

const FALLBACK_MESSAGE = '我不太確定怎麼回答這個問題，可以換個說法，或試試「哪些食物高風險」、「找空氣品質的組件」、「最近食安累犯有哪些」嗎？';

// ============================================================================
// FE 端 focus 意圖偵測 — 因為 TWCC llama3.3-70b 對 tool calling 的可靠性有限,
// 改用「確定性偵測 + LLM 兜底」的 hybrid 策略:
//   - 強匹配關鍵字 → FE 直接派發 focus（不等 LLM）→ 保證畫面立即切到正確組件
//   - 弱匹配 / 沒匹配 → 維持 LLM 自主判斷的路徑
// LLM 仍負責文字分析(可能有幻覺,接受),但畫面切換從「LLM 抽獎」變成「FE 確定」。
// 這違背極簡契約,但模型弱是現實,demo 可靠性 > 架構純粹。
// ============================================================================

// component_index → 觸發關鍵字(用 RegExp,可加入同義詞)。
// 只列出真實存在於 DB 的 15 個 index 中、跟我們食安主題相關的 7 個,其他維持 LLM 判斷。
const COMPONENT_KEYWORDS = [
	{ idx: 'hospitals', patterns: [/醫療機構|醫院分布|醫院位置|醫療資源|診所/] },
	{ idx: 'food_safety_vulnerable_exposure', patterns: [/校園.*食安.*暴露|幼兒園.*食安|校園.*受影響/] },
	{ idx: 'food_safety_care_exposure', patterns: [/長照.*(?:食安|暴露)|養老.*食安|長照機構受影響/] },
	{ idx: 'school_food_risk', patterns: [/中小學.*(?:食安|風險)|學校風險(?:地圖)?|校園.*風險地圖/] },
	{ idx: 'school_supplier_picker', patterns: [/廠商.*(?:供應|查詢)|供應商查詢|廠商供應(?:學校)?/] },
	{ idx: 'food_supply_chain', patterns: [/食品供應鏈|供應鏈.*(?:追溯|風險)/] },
	{ idx: 'school_outbreak_trace', patterns: [/食安事件(?:溯源)?|學校.*事件.*溯源|outbreak/i] },
];

const TPE_DISTRICTS = ['中正區', '大同區', '中山區', '松山區', '大安區', '萬華區', '信義區', '士林區', '北投區', '內湖區', '南港區', '文山區'];
const NEW_TPE_DISTRICTS = ['板橋區', '三重區', '中和區', '永和區', '新莊區', '新店區', '土城區', '蘆洲區', '汐止區', '樹林區', '鶯歌區', '三峽區', '淡水區', '瑞芳區', '五股區', '泰山區', '林口區', '深坑區', '石碇區', '坪林區', '三芝區', '石門區', '八里區', '平溪區', '雙溪區', '貢寮區', '金山區', '萬里區', '烏來區'];

// 從使用者本輪問句解析出 focus 意圖。回傳 null 表示沒命中任何強匹配 → 交給 LLM。
function detectFocusIntent(text) {
	if (!text) return null;
	let component_index = null;
	for (const { idx, patterns } of COMPONENT_KEYWORDS) {
		if (patterns.some((p) => p.test(text))) {
			component_index = idx;
			break;
		}
	}
	if (!component_index) return null;

	let city = null;
	let district = null;
	for (const d of TPE_DISTRICTS) {
		if (text.includes(d)) { district = d; city = 'taipei'; break; }
	}
	if (!district) {
		for (const d of NEW_TPE_DISTRICTS) {
			if (text.includes(d)) { district = d; city = 'newtaipei'; break; }
		}
	}
	if (!city) {
		if (/臺北|台北/.test(text) && !/新北/.test(text)) city = 'taipei';
		else if (/新北/.test(text)) city = 'newtaipei';
		else city = 'metrotaipei';
	}

	return {
		component_index,
		city,
		filters: district ? { district } : {},
		_source: 'fe_keyword', // debug 標記
	};
}

export const useChatStore = defineStore('chat', () => {
	const defaultChatData = [
		{
			id: 1,
			role: 'bot',
			isDefault: true,
			content:
				'您好，我是【臺北城市儀表板】小幫手，已升級為 AI 對話助理！\n\n您可以問我：\n • 「幫我找空氣品質的組件」 — 我會搜尋並推薦儀表板組件\n • 「本週最該稽查的店是哪些？」 — 我會查食安資料給出建議\n • 「它們在哪？」「為什麼？」 — 我能接續上文回答\n\n📩 聯絡信箱：tuic@gov.taipei',
		},
	];

	const recommendComponents = ref(null);

	// LLM 透過 focus_dashboard_view 下的 UI 指令最近一次值，
	// 供其他 view (例如 AI 顧問頁) 監聽並做更細的反應（高亮、展開區塊等）
	const focusDirective = ref(null);

	const savedChatData = JSON.parse(sessionStorage.getItem('chatData')) || [];
	const chatData = ref([...defaultChatData, ...savedChatData]);

	const chatStreaming = ref(false);

	// 把 LLM 的 focus_dashboard_view 指令套用到地圖：找組件 → 加圖層 → 套 district/city filter。
	// 失敗 fallback 為 silent — LLM 的文字回答仍在，使用者體驗不會炸。
	const applyFocusDirective = async (params) => {
		try {
			focusDirective.value = params;
			const { component_index, city, filters } = params || {};
			if (!component_index) return;

			const mapStore = useMapStore();
			const contentStore = useContentStore();
			if (!mapStore.map) return; // 不在 map view 就不動作

			const components = contentStore.cityDashboard?.components || [];
			const component = components.find((c) => c.index === component_index);
			if (!component || !Array.isArray(component.map_config) || component.map_config.length === 0) {
				// component 不在當前儀表板就靜默跳過 — LLM 的文字答案還在
				return;
			}

			// 過濾 city — 若指定城市，只加該城市 layer + metrotaipei（雙北全集）
			let mapConfigs = component.map_config;
			if (city) {
				const filtered = mapConfigs.filter((mc) => mc.city === city || mc.city === 'metrotaipei');
				if (filtered.length > 0) mapConfigs = filtered;
			}

			mapStore.addToMapLayerList(mapConfigs);

			// 套用城市 view（飛到對應 zoom/center）
			if (city) {
				const cityViewKey = city === 'taipei' ? 'taipei' : 'metrotaipei';
				mapStore.updateMapViewForCity(cityViewKey);
			}

			// 套 district filter — 直接用 mapbox setFilter，等 layer 載入完才呼叫
			const districtName = filters?.district;
			if (districtName) {
				const tryApplyFilter = (attempt = 0) => {
					mapConfigs.forEach((mc) => {
						const layerId = `${mc.index}-${mc.type}-${mc.city}`;
						if (mapStore.map && mapStore.map.getLayer && mapStore.map.getLayer(layerId)) {
							try {
								mapStore.map.setFilter(layerId, ['==', ['get', 'district'], districtName]);
							} catch { /* 該 layer 沒有 district 屬性就忽略 */ }
						} else if (attempt < 6) {
							setTimeout(() => tryApplyFilter(attempt + 1), 400);
						}
					});
				};
				setTimeout(() => tryApplyFilter(0), 500);
			}
		} catch {
			// 失敗 silent — LLM 文字回答仍可看
		}
	};

	watch(
		chatData,
		(newVal) => {
			const userBotMessages = newVal.filter((item) => !item.isDefault);
			sessionStorage.setItem('chatData', JSON.stringify(userBotMessages));
		},
		{ deep: true }
	);

	const addChatData = (newChatData) => {
		chatData.value.push({ id: chatData.value.length + 1, isDefault: false, ...newChatData });
	};

	// 不再用對話歷史 — TWCC 16k context 很緊,加上 BE 端 multi-turn tool result 就爆。
	// 改成單輪獨立呼叫,每輪只送當前 user msg。失去多輪一致性但換到不爆 context。

	// 主對話入口：使用者送出訊息 → BE LLM (帶完整 tools + tool_choice:auto) → 顯示回答
	const sendChat = async (text) => {
		if (chatStreaming.value) return;
		const trimmed = text?.trim();
		if (!trimmed) return;

		chatData.value.push({
			id: chatData.value.length + 1,
			role: 'user',
			isDefault: false,
			content: trimmed,
		});

		const botMessage = {
			id: chatData.value.length + 1,
			role: 'bot',
			isDefault: false,
			content: '',
			toolCalls: [],
		};
		chatData.value.push(botMessage);
		const botIdx = chatData.value.length - 1;
		chatStreaming.value = true;

		// FE 端意圖偵測 — 在 LLM 之前先做一次強匹配判斷:
		//   命中 → 立刻派發 focus(畫面馬上切),LLM 後續只負責文字分析
		//   沒命中 → 維持原本「讓 LLM 自己呼叫 focus_dashboard_view」流程
		// 這是 hybrid 策略,確保「我想看醫療機構」「新莊區食安怎樣」這類明確指令
		// 不會因為模型弱、tool calling 不穩而錯過或延遲。
		const fePreFocus = detectFocusIntent(trimmed);
		if (fePreFocus) {
			applyFocusDirective(fePreFocus); // 不 await — 不阻塞 LLM
		}

		// 雙路徑:命中 fePreFocus → 無工具快路徑(極省 token)
		//        沒命中 → 一般工具路徑(LLM 自己呼叫資料 tool)
		// 兩條路徑都 **不送歷史 + 不送 componentContext**,單輪獨立。
		// (TWCC 16k context 很緊,BE 端 multi-turn tool result 就會吃掉一大半,
		//  歷史 + 組件清單再疊上去就會爆 → 19000+ token 的事件常見)
		let messages;
		let toolsForLLM;
		let maxTokens;

		if (fePreFocus) {
			// 快路徑:畫面已切好,只要簡短文字分析 → 不需 tools
			messages = [
				{ role: 'system', content: SYSTEM_PROMPT_NO_TOOLS },
				{ role: 'user', content: trimmed },
			];
			toolsForLLM = null;
			maxTokens = 250;
		} else {
			// 工具路徑:LLM 自選工具呼叫
			messages = [
				{ role: 'system', content: SYSTEM_PROMPT_WITH_TOOLS },
				{ role: 'user', content: trimmed },
			];
			toolsForLLM = TOOLS;
			maxTokens = 350;
		}

		try {
			const payload = {
				messages,
				max_new_tokens: maxTokens,
				temperature: 0.1,
				stream: false,
			};
			if (toolsForLLM) {
				payload.tools = toolsForLLM;
				payload.tool_choice = 'auto';
			}
			const resp = await http.post('/ai/chat/twai', payload);

			const data = resp.data?.data ?? {};
			let content = data.content ?? '';
			const toolsRaw = data.tools;
			const toolCallsRaw = Array.isArray(data.tool_calls) ? data.tool_calls : [];

			let executedTools = [];
			if (typeof toolsRaw === 'string' && toolsRaw && toolsRaw !== 'null') {
				try { executedTools = JSON.parse(toolsRaw); } catch { /* ignore */ }
			} else if (Array.isArray(toolsRaw)) {
				executedTools = toolsRaw;
			}

			chatData.value[botIdx].toolCalls = executedTools.map((name, i) => ({
				id: `t-${i}`,
				name,
				status: 'done',
			}));

			// 處理 LLM 的 UI 指令型 tool — 把 focus_dashboard_view 的 args 套用到地圖
			// 同一組件去重（LLM 偶爾會重複呼叫），保留第一個有效的
			const focusSeen = new Set();
			for (const tc of toolCallsRaw) {
				if (tc.name !== 'focus_dashboard_view' || !tc.args) continue;
				let parsed;
				try { parsed = JSON.parse(tc.args); } catch { continue; }
				const key = parsed.component_index;
				if (!key || focusSeen.has(key)) continue;
				focusSeen.add(key);
				await applyFocusDirective(parsed);
			}

			// 「資料關聯表 + 建立儀表板按鈕」只在使用者「純粹找組件」時才顯示。
			// 若 LLM 同回合也呼叫了食安/疾病資料 tool 或 focus_dashboard_view,
			// 代表這次是「分析任務」而非「找組件」,顯示關聯表會干擾決策回答的閱讀。
			const dataTools = ['get_food_risk_summary', 'get_top_recidivists', 'get_vulnerable_exposure', 'get_district_risk', 'get_disease_stats'];
			const calledDataOrFocus = executedTools.some(
				(t) => dataTools.includes(t) || t === 'focus_dashboard_view',
			);
			const isPureComponentSearch =
				executedTools.includes('search_dashboard_components') && !calledDataOrFocus;
			if (isPureComponentSearch) {
				try {
					const vec = await http.post(
						'/vector/component',
						new URLSearchParams({ query: trimmed, limit: 10, score: 0.78 }),
						{ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
					);
					const items = vec.data?.data || [];
					if (items.length > 0) {
						const dedup = Array.from(
							items.reduce((map, item) => {
								const exist = map.get(item.index);
								if (!exist) { map.set(item.index, item); return map; }
								if (item.city === 'metrotaipei') map.set(item.index, item);
								return map;
							}, new Map()).values()
						).sort((a, b) => b.score - a.score);
						recommendComponents.value = dedup;
						chatData.value[botIdx].relations = dedup;
						chatData.value[botIdx].button = [{ id: 1, text: '建立儀表板' }];
					}
				} catch (e) { /* ignore vector failure, LLM 文字答案還在 */ }
			}

			// 空回應 fallback — 避免使用者看到空字串以為 bot 壞了
			if (!content.trim()) content = FALLBACK_MESSAGE;

			await typewriter(content, (chunk) => {
				chatData.value[botIdx].content += chunk;
			});

			saveChatLog(trimmed, content);
		} catch (e) {
			const msg = e.response?.data?.message || e.message || String(e);
			chatData.value[botIdx].content = `[AI 失敗] ${msg}`;
		} finally {
			chatStreaming.value = false;
		}
	};

	const typewriter = (text, onChunk, charsPerTick = 4, intervalMs = 14) => {
		return new Promise((resolve) => {
			let pos = 0;
			const tick = () => {
				pos = Math.min(pos + charsPerTick, text.length);
				onChunk(text.slice(pos - charsPerTick, pos));
				if (pos < text.length) setTimeout(tick, intervalMs);
				else resolve();
			};
			tick();
		});
	};

	// 舊 API 保留：純 vector search（讓既有呼叫點不中斷）。新流程請用 sendChat。
	const addQueryData = async (newChatData) => {
		await sendChat(newChatData.content);
	};

	const saveChatLog = async (question, answer) => {
		try {
			const formData = new FormData();
			const d = new Date();
			const todayId =
				d.getFullYear() +
				String(d.getMonth() + 1).padStart(2, '0') +
				String(d.getDate()).padStart(2, '0');

			formData.append('session', 'session_' + todayId);
			formData.append('question', question);
			formData.append('answer', typeof answer === 'string' ? answer : JSON.stringify(answer));

			await http.post('/chatlog/', formData, {
				headers: { 'Content-Type': 'multipart/form-data' },
			});
		} catch (error) {
			console.error('saveChatLog error:', error);
		}
	};

	const clearChat = () => {
		chatData.value = [...defaultChatData];
		sessionStorage.removeItem('chatData');
	};

	return {
		chatData,
		recommendComponents,
		focusDirective,
		chatStreaming,
		addChatData,
		addQueryData,
		sendChat,
		saveChatLog,
		clearChat,
	};
});
