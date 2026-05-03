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
			description: "依使用者描述從本站組件向量庫搜尋最相似的儀表板組件（Qdrant）。當使用者問「我想看 XX 的儀表板/組件」「有沒有 OO 的圖表」這類問題時呼叫。",
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
			description: "雙北食安抽驗的核心摘要：總件數、Top 高頻違規食材、行政區排行、違規類別分布。當使用者問「最近食安狀況」「哪些違規多」時呼叫。無參數。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "get_top_recidivists",
			description: "多次違規累犯場域清單（店家、校園、供應商）。回傳場域名稱、違規次數、城市、所在行政區、主要違規類別、相關食材。當使用者問「累犯」「該稽查的店」「它們在哪」時呼叫。",
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
			description: "目前事件對校園、長照機構的暴露範圍：受影響學校、幼兒園、長照機構數、估計暴露人口、相關供應商。當使用者問「校園/長照受影響」時呼叫。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "get_district_risk",
			description: "指定城市的行政區風險排行（依違規件數）。當使用者問特定區或想比較行政區時呼叫。",
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
			description: "TFDA 民國 112 年全國食品中毒統計（諾羅、沙門氏菌、腸炎弧菌等 12 種病原）：件數、患者數、死亡數、相關食材、典型場所、處置策略、症狀。當使用者問「哪些食物高風險」「飲食建議」「群聚事件可能病原」「症狀反推食材」時呼叫 — 回答時主體是「食材」，病原當補充。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "focus_dashboard_view",
			description: "UI 指令型工具：當你已決定要用某個儀表板組件輔助分析時呼叫此工具，前端會自動把該組件的地圖圖層加入並套用 filter，讓使用者畫面跟你的分析重點同步。可與資料查詢工具同回合一起呼叫（例如先 get_district_risk 拿資料，再 focus_dashboard_view 把畫面切到行政區風險圖）。一次對話內針對同一組件最多呼叫 1 次。",
			parameters: {
				type: "object",
				properties: {
					component_index: {
						type: "string",
						description: "組件 index（不是 id）。常見：food_safety_district_chart（行政區排行）、school_food_risk（校園食安）、school_supplier_picker（廠商查詢）、food_supply_chain（供應鏈）、school_outbreak_trace（事件溯源）、food_safety_vulnerable_exposure（校園暴露）、food_safety_care_exposure（長照暴露）、hospitals（醫療密度）",
					},
					city: {
						type: "string",
						enum: ["taipei", "newtaipei", "metrotaipei"],
						description: "想顯示的城市範圍。雙北全集用 metrotaipei；只看台北用 taipei；只看新北用 newtaipei",
					},
					filters: {
						type: "object",
						description: "額外 filter，常見鍵：district（行政區中文名，如「新莊區」）",
					},
					reason: {
						type: "string",
						description: "簡短說明為何選此組件（一句話，給使用者理解）",
					},
				},
				required: ["component_index"],
			},
		},
	},
];

// 短 system prompt — domain 規則進 tool description（LLM 對 tool 描述的注意力比 prompt 末段強）
const SYSTEM_PROMPT = `你是【臺北城市儀表板】小幫手，專注雙北食安與儀表板導覽。
回答用中文，簡潔直接（≤ 250 字）。
有相關工具時請呼叫工具拿真實資料，並引用回傳的具體數字、食材名、場域名，不要泛泛而談。
找儀表板組件呼叫 search_dashboard_components；食安問題依問題類型呼叫對應 food/disease 工具。
分析時若有對應組件可以視覺化你的論點，**同時呼叫 focus_dashboard_view** 讓畫面跟著你的分析切換，使用者就能看到你說的東西。
找不到資料時誠實說明，不要靠通用知識亂答。`;

const FALLBACK_MESSAGE = '我不太確定怎麼回答這個問題，可以換個說法，或試試「哪些食物高風險」、「找空氣品質的組件」、「最近食安累犯有哪些」嗎？';

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

	// 把 chatData 轉成 BE 期待的 messages 格式（過濾預設訊息與 UI-only 欄位）
	const buildHistoryMessages = () => {
		return chatData.value
			.filter((m) => !m.isDefault && m.content)
			.map((m) => ({
				role: m.role === 'bot' ? 'assistant' : 'user',
				content: m.content,
			}));
	};

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

		// 把「當前儀表板實際載入的組件清單」注入 system prompt —
		// LLM 看到精確 index 才不會編造（ground truth > tool description）。
		// 沒在當前儀表板的組件,LLM 應該避免 focus（無法生效）。
		const contentStore = useContentStore();
		const loaded = (contentStore.currentDashboard?.components || [])
			.map((c) => `  - ${c.index} (${c.name}, city=${c.city})`)
			.join('\n');
		const componentContext = loaded
			? `\n\n# 當前儀表板已載入的組件（focus_dashboard_view.component_index 必須從此清單挑選，不可編造）：\n${loaded}`
			: '';

		const messages = [
			{ role: 'system', content: SYSTEM_PROMPT + componentContext },
			...buildHistoryMessages().slice(0, -1),
		];

		try {
			const resp = await http.post('/ai/chat/twai', {
				messages,
				tools: TOOLS,
				tool_choice: 'auto',
				max_new_tokens: 600,
				temperature: 0.3,
				stream: false,
			});

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

			// LLM 呼叫過 search_dashboard_components → 再打一次 vector search 拿完整 metadata 供 UI 渲染按鈕
			if (executedTools.includes('search_dashboard_components')) {
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
