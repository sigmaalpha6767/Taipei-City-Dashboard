<script setup>
import { computed } from "vue";

const props = defineProps({
	card: { type: Object, required: true },  // { id, title, content, _displayContent, citations, status }
	roleColor: { type: String, default: "#56C1F0" },
	demoMode: { type: Boolean, default: true },
});
const emits = defineEmits(["copy", "view-evidence"]);

// 把 markdown 簡單轉 HTML（粗體、換行、bullet）
function renderMd(md) {
	if (!md) return "";
	let html = md
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		// 表格簡易處理 — 直接保留 markdown 形式內嵌 pre
		.replace(/\n/g, "<br/>");
	return html;
}

const displayHtml = computed(() => renderMd(props.card._displayContent ?? ""));
const isStreaming = computed(() => props.card.status === "streaming");
</script>

<template>
	<div class="card" :style="{ borderTopColor: roleColor }">
		<div class="card__header">
			<h3 class="card__title">{{ card.title }}</h3>
			<div class="card__badges">
				<span v-if="demoMode" class="card__badge card__badge--demo">DEMO</span>
				<span v-if="isStreaming" class="card__badge card__badge--streaming">●</span>
			</div>
		</div>

		<div class="card__body">
			<div class="card__content" v-html="displayHtml" />
			<span v-if="isStreaming" class="card__cursor">▍</span>
		</div>

		<div v-if="card.citations && card.citations.length" class="card__cites">
			<span class="card__cites-label">引用：</span>
			<span
				v-for="(c, i) in card.citations" :key="i"
				class="card__cite-pill"
				@click="emits('view-evidence', c)"
			>{{ c.source }}</span>
		</div>

		<div class="card__actions">
			<button class="card__btn" @click="emits('view-evidence', card.citations?.[0])">
				<span class="material-icons-round">visibility</span>
				<span>查看證據</span>
			</button>
			<button class="card__btn" @click="emits('copy', card)">
				<span class="material-icons-round">content_copy</span>
				<span>複製</span>
			</button>
		</div>
	</div>
</template>

<style scoped lang="scss">
.card {
	display: flex;
	flex-direction: column;
	background: var(--color-component-background);
	border: 1px solid var(--color-border);
	border-top: 3px solid #56C1F0;
	border-radius: 6px;
	padding: 14px;
	gap: 8px;
	min-height: 280px;

	&__header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 8px;
	}
	&__title {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-normal-text);
		margin: 0;
		line-height: 1.4;
	}
	&__badges { display: flex; gap: 4px; flex-shrink: 0; }
	&__badge {
		font-size: 9px;
		padding: 2px 6px;
		border-radius: 4px;
		font-weight: 600;
		letter-spacing: 0.5px;
		&--demo {
			background: rgba(245, 173, 74, 0.18);
			color: #F5AD4A;
			border: 1px solid #F5AD4A;
		}
		&--streaming {
			background: rgba(86, 185, 109, 0.18);
			color: #56B96D;
			animation: pulse 1.2s ease-in-out infinite;
		}
	}

	&__body {
		flex: 1;
		font-size: 12px;
		line-height: 1.6;
		color: var(--color-normal-text);
		overflow-y: auto;
		max-height: 240px;
		padding-right: 4px;
		&::-webkit-scrollbar { width: 4px; }
		&::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 2px; }
	}
	&__content {
		:deep(strong) { color: #f5ad4a; font-weight: 700; }
	}
	&__cursor {
		color: #56C1F0;
		animation: blink 0.7s steps(2, start) infinite;
	}

	&__cites {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		font-size: 10px;
		padding-top: 8px;
		border-top: 1px solid var(--color-border);
	}
	&__cites-label { color: var(--color-complement-text); }
	&__cite-pill {
		padding: 1px 6px;
		border-radius: 8px;
		background: rgba(86, 193, 240, 0.12);
		color: #56C1F0;
		cursor: pointer;
		border: 1px solid rgba(86, 193, 240, 0.3);
		transition: all 0.15s;
		&:hover { background: rgba(86, 193, 240, 0.25); }
	}

	&__actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
		padding-top: 4px;
	}
	&__btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		font-size: 10px;
		background: transparent;
		color: var(--color-complement-text);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.15s;
		.material-icons-round { font-size: 14px; }
		&:hover {
			color: var(--color-normal-text);
			border-color: #56C1F0;
		}
	}
}

@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.4; }
}
@keyframes blink {
	to { visibility: hidden; }
}
</style>
