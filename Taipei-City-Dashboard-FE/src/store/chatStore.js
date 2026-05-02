import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import http from "../router/axios";

// 統一對話入口：原本只做 vector search，現在升級為 LLM + tool calling。
// 工具集：
//   - search_dashboard_components: 找儀表板組件（vector search，渲染成「建立儀表板」推薦表）
//   - get_food_risk_summary / get_top_recidivists / get_vulnerable_exposure / get_district_risk: 食安主題
// 對話歷史完整保留，BE 走 multi-turn tool calling loop。

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
];

const SYSTEM_PROMPT = `你是【臺北城市儀表板】小幫手，同時也是雙北食安事件分析 AI。

**回答風格**：簡潔、直接、引用具體數字。中文回應。回答 ≤ 200 字。

**工具使用原則**：
- 使用者描述要找的儀表板/組件 → 呼叫 search_dashboard_components
- 使用者問食安事件、累犯場域、行政區風險、學校長照影響 → 呼叫對應食安工具
- 使用者問「它們」「他們」「那些」這類代名詞 → 從上下文找出指涉對象，必要時重新呼叫工具取得補充資訊（如場域所在地、累犯細節等。場域包含店家、校園、供應商）
- 工具回傳的資料要充分利用，不要只重複先前回答`;

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
