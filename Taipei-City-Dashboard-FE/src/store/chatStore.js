import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import http from "../router/axios";

// 統一對話入口：原本只做 vector search，現在升級為 LLM + tool calling。
// 工具集（6 個，全部讀 postgres-data 後端）：
//   - search_dashboard_components: 找儀表板組件 (vector search Qdrant)
//   - get_food_risk_summary:       食安抽驗摘要 (food_inspection_raw)
//   - get_top_recidivists:         累犯場域 (food_inspection_raw)
//   - get_vulnerable_exposure:     校園長照影響 (vulnerable_facility_exposure + food_event_current)
//   - get_district_risk:           行政區風險 (food_inspection_raw)
//   - get_disease_stats:           食源性疾病統計 (disease_outbreak_stats, TFDA 民國 112 年)
// 對話歷史完整保留，BE 走 multi-turn tool calling loop（已加 dedup 避免重複呼叫）。

const TOOLS = [
	{
		type: "function",
		function: {
			name: "search_dashboard_components",
			description: "依照使用者描述，從本站台組件資料庫找出最相似的儀表板組件清單（vector search）。當使用者問「我想看 XX 的儀表板/組件」「有沒有 OO 的圖表」這類問題時呼叫。",
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
			description: "取得本期雙北食安抽驗的核心摘要：總件數、Top 高頻食材、行政區排行、違規類別分布。沒有參數。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "get_top_recidivists",
			description: "取得多次違規累犯場域清單（含店家、校園、供應商）。回傳場域名稱、違規次數、城市、所在行政區、主要違規類別、相關食材。當使用者問「累犯」「該稽查的場域」「它們在哪裡」之類接續問題時呼叫。",
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
			description: "取得指定城市的行政區風險排行（依違規件數）。",
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
			description: "取得衛福部食藥署 TFDA 民國 112 年全國食品中毒病因物質統計。回傳 12 種病原（諾羅、沙門氏菌、腸炎弧菌、金黃色葡萄球菌、仙人掌桿菌、大腸桿菌、組織胺、植物性、河豚毒、輪狀、肉毒、不明）的件數、患者數、死亡數、相關食材、典型場所、處置策略、檢驗方向、潛伏期、症狀。當使用者問「一般民眾飲食安全建議」「該注意什麼疾病/食材」「群聚事件可能病原」「症狀反推食材」「檢驗優先順序」時呼叫。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
];

const SYSTEM_PROMPT = `你是【臺北城市儀表板】小幫手 — 雙北食安決策分析 AI。
你能讀取 postgres-data 後端 7 張表（food_inspection_raw、school_directory、care_facility_directory、vulnerable_facility_exposure、district_exposure_summary、food_event_current、disease_outbreak_stats）取得即時資料。

**回答風格**：簡潔、直接、引用具體數字。中文回應。回答 ≤ 250 字。

**工具選擇對照**（依使用者問題類型，每次只選 1~2 個最相關的 tool，**禁止重複呼叫同一 tool**）：

| 使用者問題類型 | 該選 tool |
|---|---|
| 找儀表板組件 / 圖表 | search_dashboard_components |
| 本期食安整體狀況 / Top 違規食材 / 違規類別 | get_food_risk_summary |
| 累犯場域 / 該稽查的店或學校 / 它們在哪 | get_top_recidivists |
| 受影響學校、長照、暴露人口、當前事件 | get_vulnerable_exposure |
| 哪些行政區風險高 / 行政區排行 | get_district_risk |
| **一般民眾飲食安全建議** / **該注意什麼疾病或食材** / 病原症狀 / 檢驗方向 | **get_disease_stats** |

**重要規則**：
1. 同一個 tool 在一次對話內**最多呼叫 1 次**。tool 拿到結果後直接生成最終答案，不要重新呼叫。
2. 使用者問泛問題（如「飲食安全建議」「該注意什麼」），優先呼叫 **get_disease_stats** 加 **get_food_risk_summary**。
3. 使用者用代名詞（它們/那些）→ 從上下文找指涉，**不**呼叫第二次工具。
4. 工具失敗或無結果時，用既有知識答，**不**重試同一 tool。
5. 場域 = 店家 / 校園 / 供應商 三類；累犯場域可能是學校或食品公司。`;

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

	const savedChatData = JSON.parse(sessionStorage.getItem('chatData')) || [];
	const chatData = ref([...defaultChatData, ...savedChatData]);

	const chatStreaming = ref(false);

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

	// 主對話入口：使用者送出訊息 → BE LLM + tools → 串接結果
	const sendChat = async (text) => {
		if (chatStreaming.value) return;
		const trimmed = text?.trim();
		if (!trimmed) return;

		// 1. 加入使用者訊息
		chatData.value.push({
			id: chatData.value.length + 1,
			role: 'user',
			isDefault: false,
			content: trimmed,
		});

		// 2. 加入 bot 預留訊息
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

		const messages = [
			{ role: 'system', content: SYSTEM_PROMPT },
			...buildHistoryMessages().slice(0, -1), // 排除最後一筆空的 bot 預留
		];

		try {
			const resp = await http.post('/ai/chat/twai', {
				messages,
				tools: TOOLS,
				tool_choice: 'auto',
				max_new_tokens: 600,
				temperature: 0.4,
				stream: false,
			});

			const data = resp.data?.data ?? {};
			const content = data.content ?? '';
			const toolsRaw = data.tools;
			let executedTools = [];
			if (typeof toolsRaw === 'string' && toolsRaw && toolsRaw !== 'null') {
				try { executedTools = JSON.parse(toolsRaw); } catch { /* ignore */ }
			} else if (Array.isArray(toolsRaw)) {
				executedTools = toolsRaw;
			}

			// 模擬執行軌跡顯示
			chatData.value[botIdx].toolCalls = executedTools.map((name, i) => ({
				id: `t-${i}`,
				name,
				status: 'done',
			}));

			// 如果 LLM 呼叫過 search_dashboard_components，再打一次 vector search
			// 把推薦組件渲染成「建立儀表板」按鈕（LLM 拿到的精簡資料無法直接餵進 UI）
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

			// 打字機效果
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
		chatStreaming,
		addChatData,
		addQueryData,
		sendChat,
		saveChatLog,
		clearChat,
	};
});
