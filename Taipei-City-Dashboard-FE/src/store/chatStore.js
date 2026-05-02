import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import http from "../router/axios";

// 統一對話入口：LLM + 「資料先注入，tool 為輔助」混合策略。
// 為什麼不純走 multi-turn tool calling：TWCC llama3.3-ffm-70b 對 tool result 整合
// 能力弱，常常 call 完 tool 還是用通用知識回答 → 文不對題。
// 解法：sendChat 第一句先 pre-fetch /food/summary + /food/disease-stats，
// 把實際數字、食材名、累犯名直接注入 system prompt 的「即時資料快照」。
// LLM 一開始就「拿著資料寫答案」，不必依賴會迷路的 tool calling loop。
// 工具仍保留：search_dashboard_components（向量搜組件）、其餘 5 個食安 tool 給
// 想做精細查詢時用，但泛問題（「哪些食物高風險」「累犯在哪」）已不需 tool。

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

**最高指導原則**：本訊息底部會附「即時資料快照」（含具體食材名、件數、累犯場域、病原-食材對照表）。**先讀完快照，再用快照裡的實際資料寫答案**。快照已涵蓋 80% 食安問題的答案，請優先引用而非呼叫工具。只有快照沒有的維度（如向量搜組件、特定行政區深挖、長照學校暴露細節）才呼叫工具。

**回答風格**：直接回答使用者「實際問的東西」。中文。回答 ≤ 250 字。

**工具策略**（快照已涵蓋大部分情境；以下情況才需呼叫 tool）：

| 使用者問題類型 | 處理方式 |
|---|---|
| 「我想看 XX 組件 / 圖表」「有沒有 OO 圖」 | 呼叫 **search_dashboard_components** |
| 哪些食物高風險 / 飲食建議 / 該注意什麼疾病 / 病原症狀 / 違規食材 / Top 累犯場域 / 行政區排行 | **直接讀快照回答，不呼叫 tool** |
| 想看「特定城市」（taipei vs newtaipei）的行政區排行 | 呼叫 **get_district_risk** with city 參數 |
| 想看「校園/長照」受影響細節（學校名/人數） | 呼叫 **get_vulnerable_exposure** |
| 快照沒涵蓋的精細查詢（特定累犯排行第 N 名以後等） | 才呼叫對應 tool |

**重要規則**：
1. **預設不呼叫 tool**。先看快照能不能答完。能就直接答，不要為了 call 而 call。
2. 同一個 tool 在一次對話內**最多呼叫 1 次**，且呼叫前確認快照沒這個資料。
3. 使用者用代名詞（它們/那些）→ 從上下文找指涉，**不**呼叫第二次工具。
4. 工具失敗或無結果時，回到快照答，**不**重試同一 tool。
5. 場域 = 店家 / 校園 / 供應商 三類；累犯場域可能是學校或食品公司。

**回答內容硬規則**（違反 = 文不對題）：
- 使用者問「哪些**食物**」「哪些**食材**」「哪些東西高風險」→ 答案**主體必須是食材名稱清單**（生食/海鮮/即食便當/蛋品/肉品/...），不是病原名稱。把病原當成「為什麼」的補充說明。
- 必須引用 tool 回傳的具體欄位：食材名（"top_categories" / 病原 "related_foods"）、件數、人數、佔比，不要只說「諾羅、沙門等」這種空泛列舉。
- 結構建議：(1) 一句結論點出 Top 3-5 高風險**食材**；(2) 每項食材後括號標註關聯病原與場所；(3) 一句行動建議。

**良好回答範本**（使用者問「哪些食物高風險」）：
> 依 TFDA 112 年 633 件中毒案件 + 雙北抽驗資料，民眾要特別注意：
> ① **生食/即食食品**（諾羅 187 件 / 1,658 人，佔 29.8%，常見於餐廳、外帶便當）
> ② **海鮮類**（腸炎弧菌 + 河豚毒，唯一死亡案例為河豚毒）
> ③ **蛋品/肉品**（沙門氏菌 25 件 / 1,107 人，加熱不足是主因）
> ④ **米飯/麵食久放**（仙人掌桿菌 19 件 / 927 人，常溫超過 2 小時就有風險）
> 行動：外食選有 HACCP 認證、生食當餐吃完、剩飯 2 小時內冷藏。

**禁止回答範本**（這就是「文不對題」）：
> ❌「主要病原體包括諾羅病毒、沙門氏菌、金黃色葡萄球菌等。建議民眾注意食品來源和安全性。」
> 為什麼錯：使用者問「食物」你卻只列病原；建議是空話沒指名食材。`;

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

	// 即時資料快照：第一次 sendChat 時 pre-fetch 後 cache 整個 session 重用。
	// 這份資料會直接注入 system prompt，讓 LLM 不用 call tool 就能拿到具體數字。
	const referenceSnapshot = ref('');
	let referenceFetchPromise = null;

	const buildReferenceSnapshot = async () => {
		if (referenceSnapshot.value) return referenceSnapshot.value;
		if (referenceFetchPromise) return referenceFetchPromise;

		referenceFetchPromise = (async () => {
			const lines = [];
			const [summaryRes, diseaseRes] = await Promise.allSettled([
				http.get('/food/summary'),
				http.get('/food/disease-stats'),
			]);

			if (summaryRes.status === 'fulfilled') {
				const d = summaryRes.value?.data?.data;
				if (d) {
					lines.push('## 雙北食安抽驗（postgres-data 即時資料）');
					if (d.summary) {
						lines.push(`- 總違規件數：${d.summary.total_fail_count} 件，涵蓋 ${d.summary.involved_district_count} 區，期間 ${d.metadata?.data_period || '—'}`);
						const vt = d.summary.violation_type_breakdown || {};
						const vtList = Object.entries(vt).sort((a, b) => b[1] - a[1]).slice(0, 5)
							.map(([k, v]) => `${k}(${v}件)`).join('、');
						if (vtList) lines.push(`- 違規類別 Top 5：${vtList}`);
					}
					const samples = (d.samples || []).slice(0, 8)
						.map(s => `${s.sample_name}(${s.fail_count}件，主違: ${s.main_violation_type})`).join('、');
					if (samples) lines.push(`- 高頻違規食材 Top 8：${samples}`);
					const districts = (d.districts || []).slice(0, 6)
						.map(x => `${x.city || ''}${x.district}(${x.fail_count}件)`).join('、');
					if (districts) lines.push(`- 風險前 6 行政區：${districts}`);
					const recids = (d.recidivists || []).slice(0, 5)
						.map(r => {
							const dist = Array.isArray(r.districts) && r.districts.length ? r.districts.join('、') : '';
							const loc = [r.city, dist].filter(Boolean).join(' ');
							return `${r.store_name}[${r.fail_count}次違規${loc ? '／' + loc : ''}；主違: ${r.main_violation_type || '—'}]`;
						}).join('、');
					if (recids) lines.push(`- Top 5 累犯場域：${recids}`);
				}
			}

			if (diseaseRes.status === 'fulfilled') {
				const d = diseaseRes.value?.data?.data;
				if (d?.summary && d?.items) {
					const s = d.summary;
					const yr = s.data_year ? `${s.data_year - 1911}` : '112';
					lines.push('');
					lines.push(`## TFDA 民國 ${yr} 年食品中毒（${s.data_scope === 'national' ? '全國' : '雙北'}，可作為食材—病原參照）`);
					lines.push(`- 全年 ${s.total_cases} 件 / ${s.total_patients} 人 / ${s.total_deaths} 死`);
					lines.push(`- 病因判明 ${s.identified_cases} 件（${s.identified_share_pct}%）；不明 ${s.unknown_cases} 件`);
					lines.push('- 各病原 → 相關食材 對照（直接引用此清單回答「哪些食物高風險」）：');
					(d.items || []).filter(p => p.pathogen_type !== 'unknown').slice(0, 12).forEach(p => {
						const foods = Array.isArray(p.related_foods) ? p.related_foods.join('、') : (p.related_foods || '不限');
						const death = p.death_count > 0 ? ` / ${p.death_count}死` : '';
						lines.push(`  · ${p.pathogen}：${p.case_count}件 / ${p.patient_count}人${death}（佔 ${p.case_share_pct}%）→ 食材：${foods}；場所：${p.typical_settings || '—'}；症狀：${p.main_symptom || '—'}`);
					});
				}
			}

			referenceSnapshot.value = lines.join('\n');
			return referenceSnapshot.value;
		})();
		return referenceFetchPromise;
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

	// 對話 topic 路徑分流（避免食安 snapshot 污染所有問題）：
	//   FAQ:  「哪些食物/該注意什麼疾病食材/飲食建議」→ 短 prompt + 資料塞 user msg + 無 tool
	//   COMP: 「找/有沒有 XX 組件/圖表/儀表板」→ 乾淨 prompt + 只給 search_dashboard_components
	//   FOOD: 「累犯/抽驗/稽查/店家/食材」→ 食安 system prompt + snapshot + 食安 tools
	//   CHAT: 你好/謝謝/閒聊/找不到 keyword → minimal prompt 無 tool
	const FOOD_FAQ_REGEX = /(?:哪些(?:食物|食材|東西)|什麼食物|什麼東西.*(?:風險|危險)|高風險食物|風險食物|該避(?:開|免)|食物.*(?:風險|危險)|飲食安全|該注意.*(?:食材|食物|疾病|什麼)|市民.*(?:建議|注意)|民眾.*(?:建議|注意)|(?:一般|普通).*(?:民眾|市民|人).*(?:風險|建議|注意))/;
	const COMPONENT_REGEX = /(?:組件|圖表|儀表板|dashboard|chart)/i;
	const FOOD_DEEP_REGEX = /(?:累犯|抽驗|稽查|食安|違規|店家|供應商|食材|食品|食源|疾病|病原|諾羅|沙門|TFDA|衛福|長照|校園|脆弱|暴露|行政區.*(?:風險|排行)|風險.*行政區)/;

	const detectTopic = (q) => {
		if (FOOD_FAQ_REGEX.test(q)) return 'faq';
		if (COMPONENT_REGEX.test(q)) return 'component';
		if (FOOD_DEEP_REGEX.test(q)) return 'food';
		return 'chat';
	};

	// 主對話入口：使用者送出訊息 → BE LLM (+/- tools) → 串接結果
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

		const topic = detectTopic(trimmed);
		// 食安類才需要 snapshot；其他主題不 fetch（也避免污染）
		const needSnapshot = topic === 'faq' || topic === 'food';
		const snapshot = needSnapshot ? await buildReferenceSnapshot().catch(() => '') : '';

		let messages;
		let payloadTools = null; // null = 該 path 不傳 tools

		if (topic === 'faq' && snapshot) {
			messages = [
				{
					role: 'system',
					content: '你是雙北食安顧問。直接用使用者提供的「資料」回答，主體必須是「食材名稱」（不是病原名）。中文，≤ 220 字。每項食材後括號標註關聯病原與案件數。最後一句行動建議。禁止只列病原名後說「請注意食品安全」這種空話。'
				},
				...buildHistoryMessages().slice(0, -1).slice(-4),
				{
					role: 'user',
					content: `問題：${trimmed}\n\n以下是雙北食安 + TFDA 即時資料（請直接從中挑出相關食材回答）：\n\n${snapshot}`
				},
			];
		} else if (topic === 'component') {
			messages = [
				{
					role: 'system',
					content: '你是【臺北城市儀表板】導覽小幫手。使用者要找儀表板組件或圖表時，**必須**呼叫 search_dashboard_components 工具搜尋，不要憑空回答。回應 ≤ 100 字介紹找到的組件。'
				},
				...buildHistoryMessages().slice(0, -1),
			];
			payloadTools = [TOOLS[0]]; // 只給 search_dashboard_components
		} else if (topic === 'food' && snapshot) {
			messages = [
				{
					role: 'system',
					content: `${SYSTEM_PROMPT}\n\n# 即時資料快照（請直接引用實際數字、食材名、場域名回答）\n\n${snapshot}`
				},
				...buildHistoryMessages().slice(0, -1),
			];
			payloadTools = TOOLS.slice(1); // 食安 tools，不含 search_dashboard_components 避免誤觸
		} else {
			// chat: 一般閒聊 / 沒命中 keyword
			messages = [
				{
					role: 'system',
					content: '你是【臺北城市儀表板】小幫手。簡潔回答使用者問題（中文，≤ 150 字）。如果使用者要找儀表板組件，請提示他們可以說「幫我找 XX 的組件」；如果問食安，可以提示「哪些食物高風險」。'
				},
				...buildHistoryMessages().slice(0, -1),
			];
		}

		try {
			const payload = {
				messages,
				max_new_tokens: 600,
				temperature: topic === 'faq' ? 0.3 : 0.4,
				stream: false,
			};
			if (payloadTools) {
				payload.tools = payloadTools;
				payload.tool_choice = 'auto';
			}
			const resp = await http.post('/ai/chat/twai', payload);

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
