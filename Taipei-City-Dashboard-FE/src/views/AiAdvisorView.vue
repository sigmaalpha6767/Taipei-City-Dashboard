<script setup>
import { computed, onMounted, ref, reactive, watch } from "vue";
import { storeToRefs } from "pinia";
import { useAiAdvisorStore } from "../store/aiAdvisorStore";

const aiStore = useAiAdvisorStore();
const {
	demoData, metadata, eventSummary, propagationSummary, diseaseSummary,
	roleResponses, activeRole, docResponses, activeDoc,
	audience,
} = storeToRefs(aiStore);

onMounted(() => aiStore.init());

// 依 audience 動態切換角色與行動模板
const aiRoles = computed(() => aiStore.aiRoles);
const docTemplates = computed(() => aiStore.docTemplates);
const chatSuggestions = computed(() => demoData.value?.chat_suggestions ?? []);
const isCitizen = computed(() => audience.value === "citizen");

function handleRoleClick(roleId) { aiStore.generateRoleAction(roleId); }
function handleDocClick(docId) { aiStore.generateDoc(docId); }
function setAudience(v) { aiStore.setAudience(v); }

function copyText(text) {
	if (navigator.clipboard) navigator.clipboard.writeText(text);
}

function renderMd(md) {
	if (!md) return "";
	return md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\n/g, "<br/>");
}

function n(v) { return (v ?? 0).toLocaleString(); }

// 對齊全站主題：色彩全部走 CSS variable，AI 決策頁不引入額外色票
// 「重點 / 一般」只用 var(--color-highlight) vs var(--color-complement-text)
function isHighRiskViolation(type) {
	return ["重金屬", "農藥殘留", "動物用藥"].includes(type);
}
function isHighRiskLevel(level) {
	return level === "red" || level === "orange";
}

// 違規類別百分比排序
const violationBars = computed(() => {
	const breakdown = eventSummary.value?.violationBreakdown || {};
	const total = Object.values(breakdown).reduce((a, b) => a + b, 0) || 1;
	return Object.entries(breakdown)
		.sort(([, a], [, b]) => b - a)
		.map(([type, count]) => ({
			type,
			count,
			pct: Math.round((count / total) * 100),
			highlight: isHighRiskViolation(type),
		}));
});

// 中華民國年月日
function rocDate() {
	const d = new Date();
	const y = d.getFullYear() - 1911;
	const m = d.getMonth() + 1;
	const day = d.getDate();
	return `中華民國${y}年${m}月${day}日`;
}

// 隨機公文發文字號（demo 用）
function genDocRef(prefix) {
	const y = new Date().getFullYear() - 1911;
	const num = String(Math.floor(Math.random() * 9 + 1)) + "00" +
		String(Math.floor(Math.random() * 90000) + 10000) +
		String(Math.floor(Math.random() * 900) + 100);
	return `${prefix || "字第"}${y}${num}號`;
}

// 給每張公文一個 stable 字號（cache to ensure 不每次 re-render 都變）
const docRefCache = {};
function docRefFor(docId, prefix) {
	if (!docRefCache[docId]) docRefCache[docId] = genDocRef(prefix);
	return docRefCache[docId];
}

// 從全部模板找（跨 audience 也能正確 lookup）
const activeDocTemplate = computed(() =>
	aiStore.allTemplates.find(d => d.id === activeDoc.value) ?? null
);

// === 公文編輯 / 匯出 ===
const editing = ref(false);
const editedBody = reactive({});  // { docId: text }
const editedMeta = reactive({});  // { docId: { addressee, cc, contact_person, contact_phone, signer } }

// 初始化編輯欄位（streaming 完成且第一次編輯時）
function initDocEdit(docId) {
	const doc = docTemplates.value.find(d => d.id === docId);
	const resp = docResponses.value[docId];
	if (!doc || !resp) return;
	if (!(docId in editedBody)) {
		editedBody[docId] = resp.content || "";
	}
	if (!(docId in editedMeta)) {
		editedMeta[docId] = {
			addressee: doc.doc_meta?.addressee || "",
			cc: doc.doc_meta?.cc || "",
			contact_person: doc.doc_meta?.contact_person || "",
			contact_phone: doc.doc_meta?.contact_phone || "",
			signer: "局　長　○○○",
			speed: doc.doc_meta?.speed || "普通",
			secrecy: doc.doc_meta?.secrecy || "普通",
		};
	}
}

// 取得目前要顯示/列印的內容（已編輯版優先）
function bodyOf(docId) {
	return docId in editedBody ? editedBody[docId] : (docResponses.value[docId]?.content || "");
}

function metaOf(docId, key) {
	const doc = docTemplates.value.find(d => d.id === docId);
	const def = {
		addressee: doc?.doc_meta?.addressee || "",
		cc: doc?.doc_meta?.cc || "",
		contact_person: doc?.doc_meta?.contact_person || "",
		contact_phone: doc?.doc_meta?.contact_phone || "",
		signer: "局　長　○○○",
		speed: doc?.doc_meta?.speed || "普通",
		secrecy: doc?.doc_meta?.secrecy || "普通",
	}[key];
	return editedMeta[docId]?.[key] ?? def;
}

function setMeta(docId, key, val) {
	if (!editedMeta[docId]) initDocEdit(docId);
	editedMeta[docId][key] = val;
}

function setBody(docId, val) {
	editedBody[docId] = val;
}

function toggleEdit() {
	if (!activeDoc.value) return;
	if (!editing.value) initDocEdit(activeDoc.value);
	editing.value = !editing.value;
}

// 切公文時自動退出編輯模式
watch(activeDoc, () => { editing.value = false; });

// 重新生成（清掉編輯）
function regenerateDoc() {
	if (!activeDoc.value) return;
	delete editedBody[activeDoc.value];
	delete editedMeta[activeDoc.value];
	editing.value = false;
	aiStore.generateDoc(activeDoc.value);
}

// 開乾淨新視窗列印（避免 SPA 浮動元素干擾）
function printDoc() {
	editing.value = false;  // 退出編輯模式
	// 等 DOM 切回唯讀
	setTimeout(() => {
		const docId = activeDoc.value;
		const doc = activeDocTemplate.value;
		const resp = docResponses.value[docId];
		if (!doc || !resp) return;

		const body = renderMd(bodyOf(docId));
		const m = {
			org: doc.doc_meta?.org || "",
			kind: doc.doc_meta?.doc_kind || "",
			addressee: metaOf(docId, "addressee"),
			cc: metaOf(docId, "cc"),
			contact_person: metaOf(docId, "contact_person"),
			contact_phone: metaOf(docId, "contact_phone"),
			signer: metaOf(docId, "signer"),
			speed: metaOf(docId, "speed"),
			secrecy: metaOf(docId, "secrecy"),
			ref: docRefFor(docId, doc.doc_meta?.ref_prefix),
			date: rocDate(),
			docType: doc.doc_type,
		};

		const isLetter = m.docType === "official_letter";
		const isAnnouncement = m.docType === "public_announcement";
		const isTask = m.docType === "task_assignment";

		// 對齊行政院文書處理手冊：函格式
		const letterTopRow = `
			<div class="topbar">
				<div class="topbar-left">
					<div><span class="lbl">檔　號：</span><span class="val">${m.ref.split("第")[1] || ""}</span></div>
					<div><span class="lbl">保存年限：</span><span class="val">10 年</span></div>
				</div>
				<div class="topbar-right">
					<div>地　址：臺北市信義區市府路 1 號</div>
					<div>聯絡人：${m.contact_person}</div>
					<div>聯絡電話：${m.contact_phone}</div>
					<div>傳　真：(02) 2720-5535</div>
				</div>
			</div>
		`;

		const metaHTML = isLetter ? `
			<div class="addressee">受文者：${m.addressee}</div>
			<div class="meta">
				<div class="row two">
					<div><span class="k">發文日期：</span><span class="v">${m.date}</span></div>
					<div><span class="k">發文字號：</span><span class="v">${m.ref}</span></div>
				</div>
				<div class="row two">
					<div><span class="k">速　　別：</span><span class="v">${m.speed}</span></div>
					<div><span class="k">密等及解密條件：</span><span class="v">${m.secrecy}</span></div>
				</div>
				<div class="row"><span class="k">附　　件：</span><span class="v">如說明所載</span></div>
			</div>
		` : isAnnouncement ? `
			<div class="ann-meta">
				<div>中華民國紀年：${m.date.replace("中華民國", "")}</div>
				<div>發文字號：${m.ref}</div>
			</div>
		` : isTask ? `
			<div class="task-meta">
				<div><span class="k">派工日期：</span>${m.date}</div>
				<div><span class="k">承辦單位：</span>${m.org}</div>
				<div><span class="k">編　　號：</span>${m.ref}</div>
			</div>
		` : "";

		const footerHTML = isLetter ? `
			<div class="footer">
				<div class="cc"><span class="k">正　　本：</span><span class="v">${m.addressee}</span></div>
				<div class="cc"><span class="k">副　　本：</span><span class="v">${m.cc}</span></div>
				<div class="signature-block">
					<div class="signer-title">${m.org}</div>
					<div class="signer-name">${m.signer}</div>
					<div class="seal">
						<div class="seal-circle">
							<div class="seal-text-1">${m.org.replace(/^.{0,2}/, "")}</div>
							<div class="seal-text-2">印</div>
						</div>
					</div>
				</div>
			</div>
		` : isAnnouncement ? `
			<div class="ann-footer">
				<div class="ann-org-name">${m.org}</div>
				<div class="ann-leader">機關首長　○○○</div>
				<div class="seal-corner">
					<div class="seal-circle">
						<div class="seal-text-1">${m.org.slice(-3)}</div>
						<div class="seal-text-2">印</div>
					</div>
				</div>
			</div>
		` : isTask ? `
			<div class="task-footer">
				<div class="task-line">
					<span>派工人：______________</span>
					<span>受派人簽收：______________</span>
				</div>
				<div class="task-line">
					<span>承辦：${m.org}</span>
					<span>列印日期：${m.date}</span>
				</div>
			</div>
		` : "";

		// 函標頭 — 機關銜全名 + 文別 大字距
		const headerHTML = isLetter ? `
			${letterTopRow}
			<div class="header">
				<span class="org">${m.org}</span>
				<span class="kind">${m.kind}</span>
			</div>
		` : isAnnouncement ? `
			<div class="ann-header">
				<div class="ann-org">${m.org}</div>
				<div class="ann-kind">公　　告</div>
			</div>
		` : isTask ? `
			<div class="task-header">
				<div class="task-org">${m.org}</div>
				<div class="task-kind">任　務　派　工　單</div>
			</div>
		` : "";

		const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>${doc.label}_${m.date.replace(/[年月日]/g, "")}</title>
<style>
  @page { size: A4; margin: 2.5cm 2cm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: "標楷體", "DFKai-SB", "BiauKai", "細明體", "新細明體", "PMingLiU", "Noto Serif TC", serif;
    font-size: 14pt;
    line-height: 1.85;
    -webkit-font-smoothing: antialiased;
  }
  .doc {
    width: 100%;
    max-width: 17cm;
    margin: 0 auto;
    padding: 0;
    page-break-inside: auto;
  }

  /* 函: 檔號 + 聯絡資訊 雙欄 */
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    font-size: 10pt;
    color: #333;
    padding-bottom: 8pt;
    margin-bottom: 6pt;
    border-bottom: 0.5pt solid #ccc;
  }
  .topbar-left { line-height: 1.6; }
  .topbar-right { line-height: 1.6; text-align: right; }
  .topbar .lbl { font-weight: 600; color: #444; }
  .topbar .val { color: #000; }

  /* 函標頭：機關銜 + 文別 */
  .header {
    text-align: center;
    padding: 6pt 0 14pt;
    border-bottom: 2pt double #000;
    margin-bottom: 16pt;
  }
  .header .org {
    display: inline-block;
    font-size: 22pt;
    font-weight: 700;
    letter-spacing: 4pt;
  }
  .header .kind {
    display: inline-block;
    font-size: 22pt;
    font-weight: 700;
    letter-spacing: 8pt;
    padding-left: 18pt;
  }

  /* 受文者 — 突顯 */
  .addressee {
    font-size: 14pt;
    padding: 4pt 0 8pt;
    margin-bottom: 8pt;
    font-weight: 600;
  }

  .meta {
    font-size: 12pt;
    padding: 4pt 0 10pt;
    margin-bottom: 14pt;
  }
  .meta .row { padding: 2pt 0; }
  .meta .row.two { display: flex; gap: 24pt; }
  .meta .row.two > div { flex: 1; }
  .meta .k { display: inline-block; min-width: 86pt; color: #444; font-weight: 600; }
  .meta .v { color: #000; }

  /* 公告專用標頭 */
  .ann-header {
    text-align: center;
    padding: 30pt 0 14pt;
  }
  .ann-org {
    font-size: 18pt;
    font-weight: 700;
    letter-spacing: 4pt;
    margin-bottom: 12pt;
  }
  .ann-kind {
    font-size: 30pt;
    font-weight: 700;
    letter-spacing: 12pt;
    border-bottom: 2pt double #000;
    display: inline-block;
    padding: 0 24pt 6pt;
  }
  .ann-meta {
    text-align: center;
    font-size: 12pt;
    padding: 14pt 0;
    line-height: 1.9;
  }
  .ann-footer {
    margin-top: 32pt;
    text-align: right;
    padding-right: 20pt;
    line-height: 2;
    font-size: 13pt;
    position: relative;
  }
  .ann-org-name { font-size: 14pt; font-weight: 700; letter-spacing: 3pt; }
  .ann-leader { font-size: 13pt; }

  /* 任務派工單 */
  .task-header { text-align: center; padding: 4pt 0 12pt; border-bottom: 1.5pt solid #000; margin-bottom: 14pt; }
  .task-org { font-size: 14pt; font-weight: 600; letter-spacing: 2pt; }
  .task-kind { font-size: 22pt; font-weight: 700; letter-spacing: 6pt; margin-top: 6pt; }
  .task-meta {
    display: flex; justify-content: space-between;
    font-size: 11pt; padding: 6pt 0 14pt;
    border-bottom: 1pt dashed #999;
    margin-bottom: 14pt;
  }
  .task-meta .k { font-weight: 600; color: #444; }
  .task-footer {
    margin-top: 28pt;
    padding-top: 14pt;
    border-top: 1pt dashed #999;
    font-size: 11pt;
    color: #333;
  }
  .task-line { display: flex; justify-content: space-between; padding: 4pt 0; }

  /* 內文 */
  .body {
    font-size: 14pt;
    line-height: 2.0;
    text-align: justify;
    word-break: break-word;
    page-break-inside: auto;
  }
  .body strong {
    color: #000;
    font-weight: 700;
    display: inline-block;
    min-width: 32pt;
    /* 主旨/說明/辦法 主標 */
  }
  .body strong:first-child { font-size: 16pt; }

  /* 函結尾：正本/副本/簽署 */
  .footer {
    margin-top: 18pt;
    padding-top: 12pt;
    border-top: 1pt dashed #aaa;
    font-size: 12pt;
    page-break-inside: avoid;
  }
  .footer .cc { padding: 2pt 0; }
  .footer .cc .k { display: inline-block; min-width: 86pt; color: #444; font-weight: 600; }
  .signature-block {
    margin-top: 28pt;
    text-align: right;
    position: relative;
    line-height: 1.9;
  }
  .signer-title { font-size: 14pt; font-weight: 700; letter-spacing: 3pt; }
  .signer-name { font-size: 14pt; padding-top: 4pt; padding-right: 50pt; }

  /* 圓形印信（仿實際機關印章） */
  .seal {
    position: absolute;
    right: 0pt;
    top: 6pt;
  }
  .seal-corner {
    position: absolute;
    right: 0;
    top: -10pt;
  }
  .seal-circle {
    width: 64pt;
    height: 64pt;
    border: 2.5pt solid #c93838;
    border-radius: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #c93838;
    transform: rotate(-6deg);
    background: rgba(201, 56, 56, 0.04);
  }
  .seal-text-1 {
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 1pt;
    line-height: 1;
  }
  .seal-text-2 {
    font-size: 18pt;
    font-weight: 900;
    letter-spacing: 0;
    line-height: 1;
    margin-top: 4pt;
  }
</style>
</head>
<body>
  <div class="doc">
    ${headerHTML}
    ${metaHTML}
    <div class="body">${body}</div>
    ${footerHTML}
  </div>
  <script>
    window.addEventListener("load", function() {
      setTimeout(function() {
        window.focus();
        window.print();
      }, 280);
    });
  <\/script>
</body>
</html>`;

		const win = window.open("", "_blank", "width=900,height=1200,scrollbars=yes");
		if (!win) {
			alert("瀏覽器擋下彈窗，請允許彈出視窗後重試");
			return;
		}
		win.document.open();
		win.document.write(html);
		win.document.close();
	}, 80);
}

// 匯出純文字 .txt
function exportTxt() {
	const docId = activeDoc.value;
	const doc = activeDocTemplate.value;
	if (!doc) return;
	const lines = [];
	lines.push("=".repeat(40));
	lines.push(`${doc.doc_meta?.org}　${doc.doc_meta?.doc_kind}`);
	lines.push("=".repeat(40));
	lines.push("");
	if (doc.doc_type === "official_letter") {
		lines.push(`受文者：${metaOf(docId, "addressee")}`);
		lines.push(`發文日期：${rocDate()}`);
		lines.push(`發文字號：${docRefFor(docId, doc.doc_meta?.ref_prefix)}`);
		lines.push(`速別：${metaOf(docId, "speed")}`);
		lines.push(`密等：${metaOf(docId, "secrecy")}`);
		lines.push("");
	} else {
		lines.push(`日期：${rocDate()}`);
		lines.push("");
	}
	lines.push(bodyOf(docId).replace(/\*\*/g, ""));
	lines.push("");
	if (doc.doc_type === "official_letter") {
		lines.push(`正本：${metaOf(docId, "addressee")}`);
		lines.push(`副本：${metaOf(docId, "cc")}`);
		lines.push("");
		lines.push(`聯絡人：${metaOf(docId, "contact_person")}　電話：${metaOf(docId, "contact_phone")}`);
		lines.push("");
		lines.push(`${doc.doc_meta?.org}　${metaOf(docId, "signer")}`);
	}
	const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${doc.label}_${rocDate().replace(/[年月]/g, "-").replace(/日/g, "")}.txt`;
	a.click();
	URL.revokeObjectURL(url);
}
</script>

<template>
	<div class="ai">
		<!-- Header -->
		<header class="ai__hd">
			<div class="ai__hd-title">
				<h1>食安 AI 應變中樞</h1>
				<span class="ai__hd-sub">
					{{ isCitizen ? '從食材異常到一般民眾每日行動的決策閉環' : (metadata.subtitle || '從食材異常到行動公文的決策閉環') }}
				</span>
			</div>
			<div class="ai__hd-meta">
				<span class="ai__pill">資料期間：{{ metadata.data_period || '—' }}</span>
				<span class="ai__pill ai__pill--live">TWCC LIVE</span>
			</div>
		</header>

		<!-- 視角切換：政府端 / 市民端（segmented control 風格） -->
		<div class="ai__audience">
			<span class="ai__audience-label">決策視角</span>
			<div class="ai__audience-toggle" role="tablist">
				<button
					class="ai__audience-btn"
					:class="{ 'is-active': !isCitizen }"
					role="tab" :aria-selected="!isCitizen"
					@click="setAudience('gov')"
				>
					<i class="ico">account_balance</i>政府端
				</button>
				<button
					class="ai__audience-btn"
					:class="{ 'is-active': isCitizen }"
					role="tab" :aria-selected="isCitizen"
					@click="setAudience('citizen')"
				>
					<i class="ico">groups</i>市民端
				</button>
			</div>
		</div>

		<div class="ai__main">
			<!-- LEFT: Event Flow + AI Actions + Doc Generator -->
			<div class="ai__left">

				<!-- Section 1: Event Summary —— 政府端與市民端共用，但市民端文案更友善 -->
				<section class="ai__section">
					<div class="ai__sec-title">
						<span>① {{ isCitizen ? '本期食安一眼看' : '食安事件摘要' }}</span>
						<span class="ai__sec-badge">{{ isCitizen ? '本週重點' : '真實資料' }}</span>
					</div>
					<div v-if="eventSummary" class="ai__event">
						<!-- Hero KPI + 違規類別橫條視覺化 -->
						<div class="ai__hero">
							<div class="ai__hero-num">
								<span class="ai__hero-big">{{ eventSummary.total }}</span>
								<span class="ai__hero-lab">{{ isCitizen ? '樣不合格食材' : '件不合格' }}</span>
							</div>
							<div class="ai__bars">
								<div v-for="b in violationBars" :key="b.type" class="ai__bar">
									<span class="ai__bar-key">{{ b.type }}</span>
									<div class="ai__bar-track">
										<div class="ai__bar-fill" :class="{ 'ai__bar-fill--hi': b.highlight }" :style="{ width: b.pct + '%' }"></div>
									</div>
									<span class="ai__bar-val">{{ b.count }}<span class="ai__bar-pct"> · {{ b.pct }}%</span></span>
								</div>
							</div>
						</div>

						<!-- Top 食材卡片（兩端共用，市民端文案不同）-->
						<div class="ai__top-title">
							<span>{{ isCitizen ? '本週要小心的食材' : '高頻不合格檢體 Top 5' }}</span>
						</div>
						<div class="ai__chips">
							<div v-for="s in (eventSummary.samplesRaw || []).slice(0, 5)" :key="s.sample_name"
								class="ai__chip"
								:class="{ 'ai__chip--hi': isHighRiskViolation(s.main_violation_type) }">
								<span class="ai__chip-name">{{ s.sample_name }}</span>
								<span class="ai__chip-meta">
									<span class="ai__chip-cnt">{{ s.fail_count }} 件</span>
									<span class="ai__chip-vio">{{ s.main_violation_type }}</span>
								</span>
							</div>
						</div>

						<!-- 行政區排行（市民端標題：你家附近狀況；政府端：紅燈行政區）-->
						<div class="ai__top-title">
							<span>{{ isCitizen ? '你家附近狀況' : '高風險行政區 Top 5' }}</span>
						</div>
						<div class="ai__districts">
							<div v-for="d in (eventSummary.districtsRaw || []).slice(0, 5)" :key="d.city + d.district"
								class="ai__dist"
								:class="{ 'ai__dist--hi': isHighRiskLevel(d.risk_level) }">
								<span class="ai__dist-name">{{ d.district }}</span>
								<span class="ai__dist-cnt">{{ d.fail_count }} 件</span>
							</div>
						</div>

						<!-- 累犯店家（只政府端顯示，對市民意義不大）-->
						<template v-if="!isCitizen && eventSummary.recidivistsRaw && eventSummary.recidivistsRaw.length">
							<div class="ai__top-title">
								<span>主要累犯店家</span>
							</div>
							<div class="ai__chips">
								<div v-for="r in eventSummary.recidivistsRaw.slice(0, 6)" :key="r.store_name" class="ai__chip ai__chip--recid">
									<span class="ai__chip-name">{{ r.store_name }}</span>
									<span class="ai__chip-meta">
										<span class="ai__chip-cnt">{{ r.fail_count }} 次違規</span>
										<span v-if="r.districts && r.districts.length" class="ai__chip-loc">{{ r.districts.join('、') }}</span>
									</span>
								</div>
							</div>
						</template>
					</div>
				</section>

				<!-- Section 2: Risk Propagation —— 政府端決策用，市民端隱藏 -->
				<section v-if="!isCitizen" class="ai__section">
					<div class="ai__sec-title">
						<span>② 風險傳播範圍</span>
						<span class="ai__sec-badge">關聯計算</span>
					</div>
					<div v-if="propagationSummary" class="ai__prop">
						<div class="ai__prop-flow">
							<div class="ai__prop-node ai__prop-node--src">
								<span class="ai__prop-num">{{ eventSummary?.total ?? 0 }}</span>
								<span class="ai__prop-lab">不合格抽驗</span>
							</div>
							<span class="ai__prop-arrow">→</span>
							<div class="ai__prop-node ai__prop-node--mid">
								<span class="ai__prop-num">{{ propagationSummary.affectedSchools + propagationSummary.affectedKindergartens + propagationSummary.affectedCare }}</span>
								<span class="ai__prop-lab">受影響場域</span>
							</div>
							<span class="ai__prop-arrow">→</span>
							<div class="ai__prop-node ai__prop-node--end">
								<span class="ai__prop-num">{{ propagationSummary.highExposureDistricts }}</span>
								<span class="ai__prop-lab">高暴露行政區</span>
							</div>
						</div>
						<div class="ai__prop-detail">
							<div class="ai__prop-tag ai__prop-tag--red"><span class="ai__dot"></span>學校 {{ propagationSummary.affectedSchools }}</div>
							<div class="ai__prop-tag ai__prop-tag--red"><span class="ai__dot"></span>幼兒園 {{ propagationSummary.affectedKindergartens }}</div>
							<div class="ai__prop-tag ai__prop-tag--orange"><span class="ai__dot"></span>長照 {{ propagationSummary.affectedCare }}</div>
							<div class="ai__prop-tag ai__prop-tag--yellow"><span class="ai__dot"></span>涉及行政區 {{ propagationSummary.affectedDistricts }}</div>
						</div>
					</div>
				</section>

				<!-- Section 3: Vulnerable Exposure —— 政府端人口暴露估算，市民端隱藏 -->
				<section v-if="!isCitizen" class="ai__section">
					<div class="ai__sec-title">
						<span>③ 脆弱族群暴露</span>
						<span class="ai__sec-badge">人口估算</span>
					</div>
					<div v-if="propagationSummary" class="ai__expo">
						<div class="ai__expo-big">
							<span class="ai__expo-num">{{ n(propagationSummary.estimatedExposed) }}</span>
							<span class="ai__expo-lab">估計暴露人口</span>
						</div>
						<div class="ai__expo-stats">
							<div class="ai__expo-stat">
								<span class="ai__expo-stat-num ai__expo-stat-num--hi">{{ propagationSummary.highExposureDistricts }}</span>
								<span class="ai__expo-stat-lab">高暴露行政區</span>
							</div>
							<div class="ai__expo-stat">
								<span class="ai__expo-stat-num">{{ propagationSummary.affectedDistricts }}</span>
								<span class="ai__expo-stat-lab">涉及行政區</span>
							</div>
							<div class="ai__expo-stat">
								<span class="ai__expo-stat-num ai__expo-stat-num--hi">{{ propagationSummary.affectedSchools + propagationSummary.affectedKindergartens + propagationSummary.affectedCare }}</span>
								<span class="ai__expo-stat-lab">受影響場域</span>
							</div>
						</div>
					</div>
				</section>

				<!-- Section 4: 病因物質判定 (Component 6) — 政府端 ④ / 市民端 ② -->
				<section v-if="diseaseSummary" class="ai__section">
					<div class="ai__sec-title">
						<span>{{ isCitizen ? '② 該避開的食材' : '④ 病因物質判定' }}</span>
						<span class="ai__sec-badge ai__sec-badge--real" v-if="diseaseSummary.isReal">
							TFDA 民國 {{ diseaseSummary.dataYear - 1911 }} 年
						</span>
					</div>

					<!-- ===== 政府端：完整 (4 KPI + Top 5 病原 含件數/處置/檢驗) ===== -->
					<template v-if="!isCitizen">
						<div class="ai__dx-kpi">
							<div class="ai__dx-cell">
								<span class="ai__dx-num">{{ n(diseaseSummary.totalCases) }}</span>
								<span class="ai__dx-lab">年度件數</span>
							</div>
							<div class="ai__dx-cell">
								<span class="ai__dx-num ai__dx-num--hi">{{ diseaseSummary.identifiedShare }}%</span>
								<span class="ai__dx-lab">病因判明率</span>
							</div>
							<div class="ai__dx-cell">
								<span class="ai__dx-num">{{ n(diseaseSummary.totalPatients) }}</span>
								<span class="ai__dx-lab">中毒患者</span>
							</div>
							<div class="ai__dx-cell">
								<span class="ai__dx-num" :class="{ 'ai__dx-num--hi': diseaseSummary.totalDeaths > 0 }">{{ diseaseSummary.totalDeaths }}</span>
								<span class="ai__dx-lab">死亡</span>
							</div>
						</div>
						<div class="ai__top-title">
							<span>Top 病原 → 反推食材 + 處置 + 檢驗</span>
						</div>
						<div class="ai__dx-rows">
							<div v-for="p in diseaseSummary.topPathogens" :key="p.pathogen" class="ai__dx-row ai__dx-row--gov">
								<div class="ai__dx-rowhead">
									<span class="ai__dx-pathogen">{{ p.pathogen }}</span>
									<span class="ai__dx-cnt">{{ p.case_count }} 件 / {{ n(p.patient_count) }} 人</span>
								</div>
								<div class="ai__dx-foods">
									<span v-for="f in p.related_foods.slice(0, 5)" :key="f" class="ai__dx-food">{{ f }}</span>
								</div>
								<div class="ai__dx-action">
									<span class="ai__dx-action-key">檢驗</span>
									<span class="ai__dx-action-val">{{ p.test_direction.split('、')[0] }}</span>
								</div>
							</div>
						</div>
					</template>

					<!-- ===== 市民端：極簡 (Top 3 病原 → 食材，inline 一行) ===== -->
					<template v-else>
						<div class="ai__dx-simple">
							<div v-for="p in diseaseSummary.topPathogens.slice(0, 3)" :key="p.pathogen" class="ai__dx-simple-row">
								<span class="ai__dx-simple-pathogen">{{ p.pathogen }}</span>
								<span class="ai__dx-simple-arrow">→</span>
								<span class="ai__dx-simple-foods">{{ p.related_foods.slice(0, 3).join('、') }}</span>
							</div>
						</div>
					</template>
				</section>

				<!-- Section 5: AI Action Recommendations (LIVE) -->
				<section class="ai__section">
					<div class="ai__sec-title">
						<span>{{ isCitizen ? '③ 我的 AI 行動建議' : '⑤ AI 行動建議' }}</span>
						<span class="ai__sec-badge ai__sec-badge--live">
							{{ isCitizen ? '選你的身分 · 即時生成' : 'TWCC Live · 點選即生' }}
						</span>
					</div>
					<div class="ai__roles">
						<button
							v-for="role in aiRoles" :key="role.id"
							class="ai__role-btn"
							:class="{ 'ai__role-btn--active': activeRole === role.id }"
							:style="activeRole === role.id ? { borderColor: role.color, color: role.color } : {}"
							@click="handleRoleClick(role.id)"
							:disabled="roleResponses[role.id]?.streaming"
						>
							<span>{{ role.label }}</span>
							<span v-if="roleResponses[role.id]?.streaming" class="ai__role-streaming">●</span>
						</button>
					</div>
					<div v-if="activeRole && roleResponses[activeRole]" class="ai__role-out">
						<!-- AI 工具呼叫指示（真 tool calling 透明展示）-->
						<div v-if="roleResponses[activeRole].toolCalls?.length" class="ai__tc-inline">
							<div v-for="tc in roleResponses[activeRole].toolCalls" :key="tc.id" class="ai__tc-row">
								<i class="ico ai__tc-ico" :class="{ 'ai__tc-ico--running': tc.status === 'running' }">
									{{ tc.status === 'running' ? 'sync' : 'check_circle' }}
								</i>
								<code class="ai__tc-name">{{ tc.name }}({{ tc.args === '{}' ? '' : tc.args }})</code>
								<span v-if="tc.ms" class="ai__tc-ms">{{ tc.ms }}ms</span>
							</div>
						</div>
						<div class="ai__role-content" v-html="renderMd(roleResponses[activeRole].content)" />
						<span v-if="roleResponses[activeRole].streaming" class="ai__cursor">▍</span>
						<div v-if="!roleResponses[activeRole].streaming && roleResponses[activeRole].content" class="ai__role-actions">
							<button class="ai__mini-btn" @click="copyText(roleResponses[activeRole].content)">
								<i class="ico">content_copy</i>複製
							</button>
							<span v-if="roleResponses[activeRole].usage" class="ai__usage">
								tokens: {{ roleResponses[activeRole].usage.total_tokens }}
							</span>
						</div>
					</div>
				</section>

				<!-- Section 5: Document Generator (LIVE) -->
				<section class="ai__section">
					<div class="ai__sec-title">
						<span>{{ isCitizen ? '④ 我的可分享行動卡片' : '⑥ AI 一鍵公文/通知產生' }}</span>
						<span class="ai__sec-badge ai__sec-badge--live">
							{{ isCitizen ? '一鍵生成・可複製轉發' : 'TWCC Live' }}
						</span>
					</div>
					<div class="ai__docs">
						<button
							v-for="doc in docTemplates" :key="doc.id"
							class="ai__doc-btn"
							:class="{ 'ai__doc-btn--active': activeDoc === doc.id }"
							@click="handleDocClick(doc.id)"
							:disabled="docResponses[doc.id]?.streaming"
						>
							<span>{{ doc.label }}</span>
							<span v-if="docResponses[doc.id]?.streaming" class="ai__role-streaming">●</span>
						</button>
					</div>
					<div v-if="activeDoc && docResponses[activeDoc]" class="ai__doc-out">
						<div v-if="docResponses[activeDoc].toolCalls?.length" class="ai__tc-inline ai__tc-inline--dark">
							<div v-for="tc in docResponses[activeDoc].toolCalls" :key="tc.id" class="ai__tc-row">
								<i class="ico ai__tc-ico" :class="{ 'ai__tc-ico--running': tc.status === 'running' }">
									{{ tc.status === 'running' ? 'sync' : 'check_circle' }}
								</i>
								<code class="ai__tc-name">{{ tc.name }}({{ tc.args === '{}' ? '' : tc.args }})</code>
								<span v-if="tc.ms" class="ai__tc-ms">{{ tc.ms }}ms</span>
							</div>
						</div>

						<!-- 市民端：行動卡片（不走公文紙樣式，純 markdown 卡片） -->
						<div v-if="activeDocTemplate?.doc_type === 'citizen_card'" class="ccard"
							:style="{ borderLeftColor: activeDocTemplate?.doc_meta?.color || 'var(--color-highlight)' }">
							<div class="ccard__top">
								<i class="ico ccard__ico" :style="{ color: activeDocTemplate?.doc_meta?.color || 'var(--color-highlight)' }">
									{{ activeDocTemplate?.icon || 'tips_and_updates' }}
								</i>
								<div class="ccard__title">
									<h3>{{ activeDocTemplate?.label }}</h3>
									<span v-if="activeDocTemplate?.doc_meta?.tag" class="ccard__tag"
										:style="{ borderColor: activeDocTemplate?.doc_meta?.color, color: activeDocTemplate?.doc_meta?.color }">
										{{ activeDocTemplate?.doc_meta?.tag }}
									</span>
								</div>
							</div>
							<div class="ccard__body" v-html="renderMd(docResponses[activeDoc].content || '生成中…')" />
							<span v-if="docResponses[activeDoc].streaming" class="ai__cursor">▍</span>
							<div v-if="!docResponses[activeDoc].streaming && docResponses[activeDoc].content" class="ccard__actions">
								<button class="ai__mini-btn" @click="copyText(docResponses[activeDoc].content)">
									<i class="ico">content_copy</i>複製文字
								</button>
								<button class="ai__mini-btn" @click="docResponses[activeDoc].content = ''; aiStore.generateDoc(activeDoc)">
									<i class="ico">refresh</i>重新生成
								</button>
							</div>
						</div>

						<!-- 政府端：公部門公文紙樣式 -->
						<div v-else class="govdoc" :data-kind="activeDocTemplate?.doc_type || 'doc'" :class="{ 'govdoc--editing': editing }">
							<!-- Header -->
							<div class="govdoc__header">
								<div class="govdoc__org">{{ activeDocTemplate?.doc_meta?.org || '臺北市政府' }}</div>
								<div class="govdoc__kind">{{ activeDocTemplate?.doc_meta?.doc_kind || '函' }}</div>
							</div>

							<!-- 機關地址 / 聯絡資訊 列（公文必備） -->
							<div v-if="activeDocTemplate?.doc_type === 'official_letter'" class="govdoc__addr">
								<div>地　　址：臺北市信義區市府路 1 號</div>
								<div>承辦單位：{{ activeDocTemplate?.doc_meta?.org }}</div>
							</div>

							<!-- Meta — 公文 -->
							<div v-if="activeDocTemplate?.doc_type === 'official_letter'" class="govdoc__meta">
								<div class="govdoc__meta-row">
									<span class="govdoc__meta-k">受文者：</span>
									<input v-if="editing" class="govdoc__input"
										:value="metaOf(activeDoc, 'addressee')"
										@input="e => setMeta(activeDoc, 'addressee', e.target.value)" />
									<span v-else class="govdoc__meta-v">{{ metaOf(activeDoc, 'addressee') }}</span>
								</div>
								<div class="govdoc__meta-row govdoc__meta-row--multi">
									<div>
										<span class="govdoc__meta-k">發文日期：</span>
										<span class="govdoc__meta-v">{{ rocDate() }}</span>
									</div>
									<div>
										<span class="govdoc__meta-k">發文字號：</span>
										<span class="govdoc__meta-v">{{ docRefFor(activeDoc, activeDocTemplate?.doc_meta?.ref_prefix) }}</span>
									</div>
								</div>
								<div class="govdoc__meta-row govdoc__meta-row--multi">
									<div>
										<span class="govdoc__meta-k">速　　別：</span>
										<select v-if="editing" class="govdoc__input"
											:value="metaOf(activeDoc, 'speed')"
											@change="e => setMeta(activeDoc, 'speed', e.target.value)">
											<option>最速件</option><option>速件</option><option>普通</option>
										</select>
										<span v-else class="govdoc__meta-v">{{ metaOf(activeDoc, 'speed') }}</span>
									</div>
									<div>
										<span class="govdoc__meta-k">密等及解密：</span>
										<span class="govdoc__meta-v">{{ metaOf(activeDoc, 'secrecy') }}</span>
									</div>
								</div>
								<div class="govdoc__meta-row">
									<span class="govdoc__meta-k">附　　件：</span>
									<span class="govdoc__meta-v">如說明所載</span>
								</div>
							</div>

							<!-- 公告 meta -->
							<div v-else-if="activeDocTemplate?.doc_type === 'public_announcement'" class="govdoc__meta govdoc__meta--center">
								<div>發文日期：{{ rocDate() }}</div>
								<div>發文字號：{{ docRefFor(activeDoc, '北市教公字第') }}</div>
							</div>

							<!-- 任務派工單 meta -->
							<div v-else-if="activeDocTemplate?.doc_type === 'task_assignment'" class="govdoc__meta govdoc__meta--center">
								<div>派工日期：{{ rocDate() }}</div>
								<div>承辦：{{ activeDocTemplate?.doc_meta?.org }}</div>
							</div>

							<!-- Body — 編輯模式 = textarea / 預覽模式 = 格式化 -->
							<textarea v-if="editing" class="govdoc__body govdoc__body--edit"
								:value="bodyOf(activeDoc)"
								@input="e => setBody(activeDoc, e.target.value)"
								rows="14"
								placeholder="公文內容（支援 markdown：**粗體**）" />
							<div v-else class="govdoc__body" v-html="renderMd(bodyOf(activeDoc))" />
							<span v-if="docResponses[activeDoc].streaming && !editing" class="ai__cursor">▍</span>

							<!-- Footer — 公文 -->
							<div v-if="activeDocTemplate?.doc_type === 'official_letter' && !docResponses[activeDoc].streaming" class="govdoc__footer">
								<div class="govdoc__cc-row">
									<span class="govdoc__meta-k">正　　本：</span>
									<input v-if="editing" class="govdoc__input"
										:value="metaOf(activeDoc, 'addressee')"
										@input="e => setMeta(activeDoc, 'addressee', e.target.value)" />
									<span v-else class="govdoc__meta-v">{{ metaOf(activeDoc, 'addressee') }}</span>
								</div>
								<div class="govdoc__cc-row">
									<span class="govdoc__meta-k">副　　本：</span>
									<input v-if="editing" class="govdoc__input"
										:value="metaOf(activeDoc, 'cc')"
										@input="e => setMeta(activeDoc, 'cc', e.target.value)" />
									<span v-else class="govdoc__meta-v">{{ metaOf(activeDoc, 'cc') }}</span>
								</div>
								<div class="govdoc__contact">
									聯絡人：
									<input v-if="editing" class="govdoc__input govdoc__input--inline"
										:value="metaOf(activeDoc, 'contact_person')"
										@input="e => setMeta(activeDoc, 'contact_person', e.target.value)" />
									<span v-else>{{ metaOf(activeDoc, 'contact_person') }}</span>
									　電話：
									<input v-if="editing" class="govdoc__input govdoc__input--inline"
										:value="metaOf(activeDoc, 'contact_phone')"
										@input="e => setMeta(activeDoc, 'contact_phone', e.target.value)" />
									<span v-else>{{ metaOf(activeDoc, 'contact_phone') }}</span>
								</div>
								<div class="govdoc__seal">
									<div class="govdoc__seal-org">{{ activeDocTemplate?.doc_meta?.org }}</div>
									<input v-if="editing" class="govdoc__input govdoc__input--center"
										:value="metaOf(activeDoc, 'signer')"
										@input="e => setMeta(activeDoc, 'signer', e.target.value)" />
									<div v-else class="govdoc__seal-stamp">{{ metaOf(activeDoc, 'signer') }}</div>
								</div>
							</div>

							<!-- 公告 / 派工單 footer -->
							<div v-else-if="activeDocTemplate?.doc_type === 'public_announcement' && !docResponses[activeDoc].streaming" class="govdoc__footer">
								<div class="govdoc__sign-center">{{ activeDocTemplate?.doc_meta?.org }}　謹啟</div>
							</div>
							<div v-else-if="activeDocTemplate?.doc_type === 'task_assignment' && !docResponses[activeDoc].streaming" class="govdoc__footer">
								<div class="govdoc__sign-center">承辦單位：{{ activeDocTemplate?.doc_meta?.org }}</div>
							</div>
						</div>

						<!-- Action Bar -->
						<div v-if="!docResponses[activeDoc].streaming && docResponses[activeDoc].content" class="ai__role-actions">
							<button class="ai__mini-btn" @click="toggleEdit()">
								<i class="ico">{{ editing ? 'check' : 'edit' }}</i>
								{{ editing ? '完成編輯' : '編輯內容' }}
							</button>
							<button class="ai__mini-btn" @click="regenerateDoc()" :disabled="editing">
								<i class="ico">refresh</i>重新生成
							</button>
							<button class="ai__mini-btn" @click="copyText(bodyOf(activeDoc))">
								<i class="ico">content_copy</i>複製本文
							</button>
							<button class="ai__mini-btn" @click="exportTxt()">
								<i class="ico">download</i>下載 .txt
							</button>
							<button class="ai__mini-btn ai__mini-btn--primary" @click="printDoc()">
								<i class="ico">print</i>列印 / 存 PDF
							</button>
						</div>
					</div>
				</section>
			</div>

			<!-- 對話補充改由全站「臺北城市儀表板小幫手」(右下浮動) 統一承接，避免兩套 chat UI -->
			<aside class="ai__right">
				<div class="ai__chat-redirect">
					<i class="ico">smart_toy</i>
					<h3>想接續追問？點右下角「臺北城市儀表板小幫手」</h3>
					<p>小幫手已升級為 AI 對話助理，可呼叫工具、保留上下文：</p>
					<ul>
						<li>「累犯店家在哪些行政區？」</li>
						<li>「這次事件影響了哪些學校？」</li>
						<li>「幫我找空氣品質的儀表板組件」</li>
					</ul>
					<p class="ai__chat-redirect-tip">支援多輪對話，會記得上文。</p>
					<div class="ai__chat-suggest">
						<span v-for="(s, i) in chatSuggestions" :key="i" class="ai__chat-suggest-chip">
							{{ s }}
						</span>
					</div>
				</div>
			</aside>
		</div>
	</div>
</template>

<style scoped lang="scss">
.ico {
	font-family: "Material Icons Round";
	font-style: normal;
	font-size: 16px;
	display: inline-block;
	vertical-align: middle;
	user-select: none;
}

.ai {
	height: calc(100vh - 60px);
	height: calc(var(--vh, 1vh) * 100 - 60px);
	overflow-y: auto;
	overflow-x: hidden;
	padding: 14px 18px 24px;
	background: var(--color-background, #11182a);
	color: var(--color-normal-text);
	display: block;
	width: 100%;
	box-sizing: border-box;

	&__hd {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
	}
	&__hd-title { display: flex; align-items: center; gap: 8px;
		h1 { font-size: 18px; font-weight: 600; margin: 0; color: var(--color-normal-text); }
	}
	&__hd-ico { display: none; }
	&__hd-sub { font-size: 11px; color: var(--color-complement-text); padding-left: 8px; border-left: 1px solid var(--color-border); }
	&__hd-meta { display: flex; gap: 6px; flex-wrap: wrap; }
	&__pill {
		font-size: 10px; padding: 3px 8px; border-radius: 10px; font-weight: 500;
		background: rgba(255,255,255,0.04);
		color: var(--color-complement-text);
		border: 1px solid var(--color-border);
		&--live { color: var(--color-highlight); border-color: var(--color-highlight); }
	}

	&__hd { margin-bottom: 10px; }

	/* === 視角切換器（segmented control） === */
	&__audience {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}
	&__audience-label {
		font-size: 13px;
		color: var(--color-complement-text);
		letter-spacing: 0.04em;
	}
	&__audience-toggle {
		display: inline-flex;
		padding: 4px;
		background: var(--color-component-background);
		border: 1px solid var(--color-border);
		border-radius: 999px;
	}
	&__audience-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 18px;
		background: transparent;
		border: none;
		border-radius: 999px;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-complement-text);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
		white-space: nowrap;

		.ico {
			font-family: "Material Icons Round";
			font-style: normal;
			font-size: 16px;
			line-height: 1;
		}

		&:hover { color: var(--color-normal-text); }

		&.is-active {
			background: var(--color-highlight);
			color: #11182a;
			.ico { color: #11182a; }
		}
	}
	&__main {
		display: grid; grid-template-columns: 2fr 1fr; gap: 12px;
		align-items: start;
		@media (max-width: 1100px) { grid-template-columns: 1fr; }
	}
	&__left { display: flex; flex-direction: column; gap: 10px; }
	&__right {
		display: flex; flex-direction: column; gap: 10px;
		position: sticky; top: 14px;
		max-height: calc(100vh - 90px);
	}

	&__chat-redirect {
		background: var(--color-component-background);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 16px 18px;
		display: flex; flex-direction: column; gap: 8px;

		.ico { font-size: 28px; color: var(--color-highlight); }
		h3 {
			margin: 0; font-size: 14px; line-height: 1.45;
			color: var(--color-normal-text); font-weight: 600;
		}
		p {
			margin: 0; font-size: 12px; line-height: 1.55;
			color: var(--color-complement-text);
		}
		ul {
			margin: 0; padding-left: 18px;
			font-size: 12px; line-height: 1.7;
			color: var(--color-normal-text);
		}
	}
	&__chat-redirect-tip {
		font-style: italic;
		color: var(--color-highlight) !important;
		font-size: 11px !important;
	}
	&__chat-suggest {
		display: flex; flex-wrap: wrap; gap: 6px;
		margin-top: 8px;
		.ai__chat-suggest-chip {
			font-size: 11px; padding: 4px 10px;
			border-radius: 999px;
			background: rgba(245, 173, 74, 0.12);
			color: var(--color-highlight);
			border: 1px solid rgba(245, 173, 74, 0.4);
		}
	}

	&__section {
		background: var(--color-component-background);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 10px 14px;
	}
	&__sec-title {
		display: flex; align-items: center; gap: 6px;
		font-size: 13px; font-weight: 600; color: var(--color-normal-text);
		padding-bottom: 6px;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 8px;
	}
	&__sec-badge {
		margin-left: auto;
		font-size: 10px; padding: 2px 7px; border-radius: 8px;
		background: rgba(255,255,255,0.06); color: var(--color-complement-text);
		font-weight: 500;
		&--live { background: rgba(86,193,240,0.18); color: var(--color-highlight); border: 1px solid var(--color-highlight); }
	}

	/* Section 1: Event — Hero + 違規橫條 + 食材 chip + 行政區 */
	&__event { display: flex; flex-direction: column; gap: 12px; }

	&__hero {
		display: grid;
		grid-template-columns: 130px 1fr;
		gap: 14px;
		align-items: center;
		@media (max-width: 720px) { grid-template-columns: 1fr; }
	}
	&__hero-num {
		display: flex; flex-direction: column; align-items: center;
		padding: 14px 8px; border-radius: 6px;
		background: rgba(0,0,0,0.18);
		border: 1px solid var(--color-border);
	}
	&__hero-big {
		font-size: 36px; font-weight: 700; color: var(--color-normal-text); line-height: 1;
	}
	&__hero-lab {
		margin-top: 4px; font-size: 11px; color: var(--color-complement-text); text-align: center;
	}

	&__bars { display: flex; flex-direction: column; gap: 5px; }
	&__bar {
		display: grid;
		grid-template-columns: 70px 1fr 56px;
		align-items: center;
		gap: 8px;
		font-size: 11px;
	}
	&__bar-key { color: var(--color-normal-text); font-weight: 500; }
	&__bar-track {
		height: 8px; border-radius: 4px;
		background: var(--color-border);
		overflow: hidden;
	}
	&__bar-fill {
		height: 100%; border-radius: 4px;
		background: var(--color-complement-text);
		transition: width 0.4s ease;
		&--hi { background: var(--color-highlight); }
	}
	&__bar-val { color: var(--color-complement-text); text-align: right; font-variant-numeric: tabular-nums; }
	&__bar-pct { font-size: 10px; opacity: 0.6; }

	&__top-title {
		font-size: 12px; font-weight: 600;
		color: var(--color-complement-text);
		padding-top: 6px;
		letter-spacing: 0.04em;
	}

	&__chips { display: flex; flex-wrap: wrap; gap: 6px; }
	&__chip {
		display: flex; flex-direction: column; gap: 2px;
		padding: 6px 10px;
		background: rgba(0,0,0,0.18);
		border-left: 2px solid var(--color-border);
		border-radius: 4px;
		min-width: 110px;
		&--hi { border-left-color: var(--color-highlight); }
	}
	&__chip-name { font-size: 12px; font-weight: 600; color: var(--color-normal-text); }
	&__chip-meta {
		display: flex; gap: 8px; align-items: center;
		font-size: 10px;
		color: var(--color-complement-text);
	}
	&__chip-cnt { font-weight: 600; }

	&__districts { display: flex; flex-wrap: wrap; gap: 6px; }
	&__dist {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 5px 10px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: rgba(0,0,0,0.15);
		font-size: 11px;
		&--hi { border-color: var(--color-highlight); }
	}
	&__dist-name { color: var(--color-normal-text); font-weight: 600; }
	&__dist-cnt { color: var(--color-complement-text); font-variant-numeric: tabular-nums; }

	/* Section 4: 病因物質判定 (Component 6) — 對齊 KPI / chip 既有風格 */
	&__sec-badge--real {
		color: var(--color-highlight);
		border: 1px solid var(--color-highlight);
		background: rgba(86, 185, 109, 0.08);
	}
	&__dx-kpi {
		display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
		margin-bottom: 8px;
	}
	&__dx-cell {
		background: rgba(0,0,0,0.18);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 8px 10px;
		display: flex; flex-direction: column; gap: 2px;
	}
	&__dx-num {
		font-size: 22px; font-weight: 700; line-height: 1;
		color: var(--color-normal-text);
		font-variant-numeric: tabular-nums;
		&--hi { color: var(--color-highlight); }
	}
	&__dx-lab { font-size: 10px; color: var(--color-complement-text); }

	&__dx-rows { display: flex; flex-direction: column; gap: 6px; }
	&__dx-row {
		display: flex; flex-direction: column; gap: 4px;
		padding: 8px 10px;
		background: rgba(0,0,0,0.12);
		border-left: 2px solid var(--color-border);
		border-radius: 3px;
		font-size: 11px;
		&--gov:hover { border-left-color: var(--color-highlight); }
	}
	&__dx-rowhead {
		display: flex; justify-content: space-between; align-items: baseline;
		gap: 8px;
	}
	&__dx-pathogen {
		color: var(--color-normal-text); font-weight: 600; font-size: 12px;
	}
	&__dx-cnt {
		color: var(--color-complement-text); font-variant-numeric: tabular-nums;
		font-size: 10px;
	}
	&__dx-foods { display: flex; flex-wrap: wrap; gap: 3px; }
	&__dx-food {
		font-size: 10px; padding: 1px 7px;
		background: rgba(255,255,255,0.04);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		color: var(--color-complement-text);
	}
	&__dx-action {
		display: flex; gap: 6px; align-items: baseline;
		font-size: 10px;
		padding-top: 2px;
		border-top: 1px dashed rgba(255,255,255,0.05);
	}
	&__dx-action-key {
		color: var(--color-highlight);
		font-weight: 600;
		min-width: 28px;
	}
	&__dx-action-val {
		color: var(--color-complement-text);
		flex: 1;
	}

	/* 市民端極簡版：一行 inline */
	&__dx-simple {
		display: flex; flex-direction: column; gap: 6px;
	}
	&__dx-simple-row {
		display: flex; align-items: center; gap: 10px;
		padding: 10px 14px;
		background: rgba(0,0,0,0.18);
		border: 1px solid var(--color-border);
		border-left: 2px solid var(--color-highlight);
		border-radius: 4px;
		font-size: 13px;
	}
	&__dx-simple-pathogen {
		color: var(--color-normal-text); font-weight: 600;
		min-width: 80px;
	}
	&__dx-simple-arrow {
		color: var(--color-complement-text);
		font-family: monospace;
	}
	&__dx-simple-foods {
		color: var(--color-complement-text);
		flex: 1;
	}

	/* Section 2: Propagation flow */
	&__prop-flow {
		display: flex; align-items: center; gap: 8px; justify-content: space-around;
		margin-bottom: 8px;
		flex-wrap: wrap;
	}
	&__prop-node {
		display: flex; flex-direction: column; align-items: center;
		padding: 8px 14px; border-radius: 6px;
		min-width: 90px;
		background: rgba(0,0,0,0.18);
		border: 1px solid var(--color-border);
		&--mid { border-color: var(--color-highlight); }
	}
	&__prop-num { font-size: 20px; font-weight: 700; color: var(--color-normal-text); line-height: 1; }
	&__prop-lab { font-size: 10px; color: var(--color-complement-text); margin-top: 2px; text-align: center; }
	&__prop-arrow {
		color: var(--color-complement-text);
		font-size: 16px;
		font-weight: 600;
		font-family: monospace;
	}
	&__prop-detail { display: flex; gap: 4px; flex-wrap: wrap; }
	&__prop-tag {
		display: inline-flex; align-items: center; gap: 5px;
		padding: 3px 10px; border-radius: 10px;
		font-size: 10px; font-weight: 500;
		background: rgba(255,255,255,0.04);
		color: var(--color-complement-text);
		border: 1px solid var(--color-border);
	}
	&__dot {
		display: inline-block;
		width: 6px; height: 6px;
		border-radius: 50%;
		background: var(--color-complement-text);
	}

	/* Section 3: Exposure */
	&__expo { display: flex; gap: 14px; align-items: center; }
	&__expo-big {
		display: flex; flex-direction: column; align-items: center;
		padding: 10px 16px;
		background: rgba(0,0,0,0.18);
		border: 1px solid var(--color-border);
		border-radius: 6px; min-width: 130px;
	}
	&__expo-num { font-size: 30px; font-weight: 700; color: var(--color-normal-text); line-height: 1; }
	&__expo-lab { font-size: 10px; color: var(--color-complement-text); margin-top: 2px; }
	&__expo-stats { display: flex; gap: 8px; flex: 1; }
	&__expo-stat {
		flex: 1;
		display: flex; flex-direction: column; align-items: center;
		padding: 8px; background: rgba(0,0,0,0.18); border-radius: 5px;
	}
	&__expo-stat-num {
		font-size: 22px; font-weight: 700; line-height: 1;
		color: var(--color-normal-text);
		&--hi { color: var(--color-highlight); }
	}
	&__expo-stat-lab { font-size: 10px; color: var(--color-complement-text); margin-top: 2px; }

	/* Section 4 + 5 buttons */
	&__roles, &__docs {
		display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
		margin-bottom: 8px;
		@media (max-width: 700px) { grid-template-columns: repeat(2, 1fr); }
	}
	&__role-btn, &__doc-btn {
		display: flex; align-items: center; justify-content: center;
		gap: 5px; padding: 9px 12px;
		background: rgba(255,255,255,0.04);
		color: var(--color-complement-text);
		border: 1.5px solid var(--color-border);
		border-radius: 6px;
		font-size: 12px; font-family: inherit; cursor: pointer;
		transition: all .15s;
		&:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: var(--color-normal-text); }
		&:disabled { opacity: 0.6; cursor: wait; }
		&--active { font-weight: 600; }
	}
	&__role-streaming { color: var(--color-highlight); animation: pulse 1.2s infinite; }

	&__role-out {
		padding: 10px 12px; background: rgba(86,193,240,0.06); border-radius: 5px;
		border-left: 3px solid var(--color-highlight);
		font-size: 12px; line-height: 1.6;
	}
	&__role-content :deep(strong) { color: var(--color-highlight); font-weight: 700; }
	&__cursor { color: var(--color-highlight); animation: blink 0.7s steps(2, start) infinite; }

	&__role-actions {
		display: flex; gap: 6px; align-items: center; margin-top: 6px;
		padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);
	}
	&__mini-btn {
		display: flex; align-items: center; gap: 3px;
		padding: 3px 8px; font-size: 10px;
		background: transparent; color: var(--color-complement-text);
		border: 1px solid var(--color-border); border-radius: 4px;
		cursor: pointer; font-family: inherit;
		.ico { font-size: 12px; }
		&:hover { color: var(--color-normal-text); border-color: var(--color-highlight); }
	}
	&__usage {
		font-size: 9px; color: var(--color-highlight);
		margin-left: auto; font-family: monospace;
	}

	/* Tool Call inline indicator */
	&__tc-inline {
		display: flex; flex-direction: column; gap: 3px;
		padding: 6px 8px;
		background: rgba(245, 173, 74, 0.08);
		border-left: 2px solid var(--color-highlight);
		border-radius: 3px;
		margin-bottom: 8px;
		&--dark { background: rgba(86,193,240,0.10); border-left-color: var(--color-highlight); }
	}
	&__tc-row {
		display: flex; align-items: center; gap: 6px;
		font-size: 10px;
	}
	&__tc-ico {
		font-size: 13px; color: var(--color-highlight);
		&--running { color: var(--color-highlight); animation: spin 1s linear infinite; }
	}
	&__tc-name {
		font-family: "Cascadia Code", "Consolas", monospace;
		color: var(--color-highlight);
		flex: 1;
		word-break: break-all;
	}
	&__tc-ms {
		font-size: 9px;
		color: var(--color-highlight);
		padding: 0 5px;
		background: rgba(86,185,109,0.12);
		border-radius: 3px;
	}

	&__doc-out {
		display: flex; flex-direction: column; gap: 8px;
	}

	/* Right column tools */
	&__tools-panel {
		background: var(--color-component-background);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 10px 14px;
		min-height: 220px;
	}
	&__tools-empty {
		font-size: 11px; color: var(--color-complement-text);
		text-align: center; padding: 30px 10px; line-height: 1.6;
	}
	&__tools-log { display: flex; flex-direction: column; gap: 5px; max-height: 260px; overflow-y: auto; }
	&__tool-entry { font-size: 10.5px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
	&__tool-name { font-family: monospace; color: var(--color-highlight); }
	&__tool-result { color: var(--color-complement-text); padding-left: 12px; }
	&__tool-meta { font-size: 9px; color: var(--color-highlight); padding-left: 12px; }
}

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@keyframes blink { to { visibility: hidden; } }
@keyframes spin { to { transform: rotate(360deg); } }

/* ========== 公部門公文紙樣式 ========== */
.govdoc {
	background: #ffffff;
	color: #1a1a1a;
	font-family: "細明體", "新細明體", "PMingLiU", "Noto Serif TC", serif;
	padding: 36px 48px 40px;
	border: 1px solid #d4d4c4;
	border-radius: 4px;
	box-shadow: 0 4px 18px rgba(0,0,0,0.35);
	font-size: 14px;
	line-height: 1.85;
	max-height: none;
	overflow: visible;
	&--editing {
		outline: 2px dashed var(--color-highlight);
		outline-offset: -8px;
	}

	&__header {
		text-align: center;
		padding-bottom: 14px;
		border-bottom: 2px solid #1a1a1a;
		margin-bottom: 14px;
	}
	&__org {
		font-size: 24px;
		font-weight: 700;
		letter-spacing: 4px;
		color: #1a1a1a;
		display: inline-block;
	}
	&__kind {
		font-size: 24px;
		font-weight: 700;
		letter-spacing: 6px;
		display: inline-block;
		padding: 0 16px;
		color: #1a1a1a;
	}

	&__addr {
		font-size: 11px;
		color: #555;
		text-align: right;
		padding-bottom: 8px;
		border-bottom: 1px dashed #ccc;
		margin-bottom: 8px;
		div { padding: 1px 0; }
	}
	&__meta {
		font-size: 13px;
		padding: 8px 0 12px;
		border-bottom: 1px dashed #aaa;
		margin-bottom: 14px;

		&--center {
			text-align: center;
			border-bottom: 1px solid #ddd;
			padding: 10px 0;
			& > div { padding: 2px 0; }
		}
	}
	&__input {
		font-family: inherit;
		font-size: 13px;
		padding: 2px 6px;
		background: #fffbe6;
		border: 1px solid #d4c266;
		border-radius: 3px;
		color: #1a1a1a;
		min-width: 200px;
		&--inline { min-width: 100px; width: auto; }
		&--center { display: block; margin: 6px auto 0; text-align: center; min-width: 200px; }
		&:focus { outline: 2px solid var(--color-highlight); outline-offset: -1px; }
	}
	&__date-center {
		font-size: 13px;
		color: #555;
		letter-spacing: 1px;
	}
	&__meta-row {
		padding: 2px 0;
		&--multi {
			display: flex; gap: 24px;
			& > div { flex: 1; }
		}
	}
	&__meta-k {
		display: inline-block;
		min-width: 80px;
		color: #444;
		font-weight: 600;
	}
	&__meta-v { color: #1a1a1a; }

	&__body {
		font-size: 15px;
		line-height: 2;
		color: #1a1a1a;
		text-align: justify;
		min-height: 120px;
		word-break: break-word;

		:deep(strong) {
			color: #1a1a1a;
			font-weight: 700;
		}
		&--edit {
			width: 100%;
			background: #fffbe6;
			border: 1px solid #d4c266;
			border-radius: 4px;
			padding: 12px;
			font-family: "細明體", "新細明體", "PMingLiU", monospace;
			font-size: 14px;
			line-height: 1.9;
			resize: vertical;
			min-height: 240px;
			outline: none;
			&:focus { border-color: var(--color-highlight); box-shadow: 0 0 0 2px rgba(86,193,240,0.18); }
		}
	}

	&__footer {
		margin-top: 18px;
		padding-top: 14px;
		border-top: 1px dashed #aaa;
		font-size: 13px;
		color: #2a2a2a;
	}
	&__cc-row {
		padding: 2px 0;
	}
	&__contact {
		margin-top: 8px;
		color: #555;
		font-size: 12px;
		font-style: italic;
	}
	&__seal {
		margin-top: 24px;
		text-align: right;
	}
	&__seal-org {
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 3px;
	}
	&__seal-stamp {
		display: inline-block;
		margin-top: 6px;
		padding: 12px 18px;
		border: 2px solid #c93838;
		border-radius: 4px;
		color: #c93838;
		font-weight: 700;
		letter-spacing: 4px;
		transform: rotate(-3deg);
		opacity: 0.85;
	}
	&__sign-center {
		text-align: center;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: 4px;
		padding: 10px 0;
	}
}

.ai__mini-btn--primary {
	background: var(--color-highlight);
	color: #11182a !important;
	border-color: var(--color-highlight);
	font-weight: 600;
	&:hover { background: #3aa9d8; border-color: #3aa9d8; color: #11182a !important; }
}

/* 列印走獨立新視窗（printDoc 函式） — 此處不需 @media print，避免干擾畫面預覽 */

/* ========== 市民端：行動卡片 ========== */
.ccard {
	background: var(--color-component-background);
	border: 1px solid var(--color-border);
	border-left: 4px solid var(--color-highlight);
	border-radius: 8px;
	padding: 18px 20px;
	margin-top: 6px;
	color: var(--color-normal-text);

	&__top {
		display: flex; align-items: center; gap: 12px;
		padding-bottom: 10px;
		border-bottom: 1px dashed var(--color-border);
		margin-bottom: 14px;
	}
	&__ico {
		font-family: "Material Icons Round";
		font-style: normal;
		font-size: 28px;
		flex-shrink: 0;
	}
	&__title {
		display: flex; align-items: center; gap: 10px; flex: 1;
		flex-wrap: wrap;
		h3 {
			margin: 0; font-size: 16px; font-weight: 600;
			color: var(--color-normal-text);
		}
	}
	&__tag {
		font-size: 11px; padding: 2px 10px;
		border: 1px solid var(--color-highlight);
		border-radius: 999px;
		font-weight: 500;
	}
	&__body {
		font-size: 14px; line-height: 1.7;
		color: var(--color-normal-text);

		h2 {
			font-size: 14px; font-weight: 700;
			margin: 14px 0 8px; padding: 4px 0;
			color: var(--color-normal-text);
			border-bottom: 1px solid var(--color-border);
		}
		h3 { font-size: 13px; margin: 10px 0 6px; }
		ol, ul { padding-left: 22px; margin: 6px 0; }
		li { margin: 4px 0; }
		p { margin: 6px 0; }
		strong { color: var(--color-highlight); }
		input[type="checkbox"] { margin-right: 6px; }
	}
	&__actions {
		display: flex; gap: 8px; margin-top: 14px;
		padding-top: 12px;
		border-top: 1px dashed var(--color-border);
	}
}
</style>
