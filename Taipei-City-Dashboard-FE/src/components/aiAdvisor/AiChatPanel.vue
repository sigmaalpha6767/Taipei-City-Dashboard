<script setup>
import { ref, watch, nextTick, computed } from "vue";

const props = defineProps({
	messages: { type: Array, required: true },
	suggestions: { type: Array, default: () => [] },
	streaming: { type: Boolean, default: false },
});
const emits = defineEmits(["send", "clear"]);

const input = ref("");
const scrollEl = ref(null);

function handleSend() {
	const text = input.value.trim();
	if (!text || props.streaming) return;
	emits("send", text);
	input.value = "";
}

function handleSuggestion(text) {
	if (props.streaming) return;
	emits("send", text);
}

watch(() => props.messages.length, () => {
	nextTick(() => {
		if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
	});
});

function renderMd(md) {
	if (!md) return "";
	return md
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\n/g, "<br/>");
}
</script>

<template>
	<div class="chat">
		<div class="chat__header">
			<span class="material-icons-round">smart_toy</span>
			<span>AI 對話補充</span>
			<button v-if="messages.length" class="chat__clear" @click="emits('clear')">
				<span class="material-icons-round">refresh</span>
			</button>
		</div>

		<div ref="scrollEl" class="chat__messages">
			<div v-if="!messages.length" class="chat__empty">
				<p>有任何進階問題？試問：</p>
				<div class="chat__suggestions">
					<button
						v-for="(s, i) in suggestions" :key="i"
						class="chat__suggestion"
						@click="handleSuggestion(s)"
					>{{ s }}</button>
				</div>
			</div>

			<div v-for="(m, i) in messages" :key="i" :class="['chat__msg', `chat__msg--${m.role}`]">
				<div class="chat__msg-avatar">
					<span class="material-icons-round">{{ m.role === 'user' ? 'person' : 'smart_toy' }}</span>
				</div>
				<div class="chat__msg-bubble" v-html="renderMd(m.content)" />
			</div>
		</div>

		<div class="chat__input-bar">
			<input
				v-model="input"
				type="text"
				class="chat__input"
				placeholder="輸入問題（如：下個月可能爆什麼？）"
				:disabled="streaming"
				@keyup.enter="handleSend"
			/>
			<button class="chat__send" :disabled="streaming || !input.trim()" @click="handleSend">
				<span class="material-icons-round">send</span>
			</button>
		</div>
	</div>
</template>

<style scoped lang="scss">
.chat {
	display: flex;
	flex-direction: column;
	background: var(--color-component-background);
	border: 1px solid var(--color-border);
	border-radius: 6px;
	height: 100%;
	min-height: 400px;
	overflow: hidden;

	&__header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 14px;
		border-bottom: 1px solid var(--color-border);
		font-size: 13px;
		font-weight: 600;
		color: var(--color-normal-text);
		.material-icons-round { font-size: 16px; color: #56C1F0; }
	}
	&__clear {
		margin-left: auto;
		background: transparent;
		border: none;
		color: var(--color-complement-text);
		cursor: pointer;
		display: flex;
		.material-icons-round { font-size: 14px; }
		&:hover { color: var(--color-normal-text); }
	}

	&__messages {
		flex: 1;
		overflow-y: auto;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		&::-webkit-scrollbar { width: 4px; }
		&::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 2px; }
	}

	&__empty {
		display: flex;
		flex-direction: column;
		gap: 8px;
		color: var(--color-complement-text);
		font-size: 12px;
		p { margin: 0 0 4px; }
	}
	&__suggestions { display: flex; flex-direction: column; gap: 4px; }
	&__suggestion {
		text-align: left;
		padding: 6px 10px;
		font-size: 11px;
		background: rgba(86, 193, 240, 0.08);
		color: #56C1F0;
		border: 1px solid rgba(86, 193, 240, 0.25);
		border-radius: 4px;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.15s;
		&:hover { background: rgba(86, 193, 240, 0.18); }
	}

	&__msg {
		display: flex;
		gap: 6px;
		font-size: 12px;
		&--user { flex-direction: row-reverse; }
	}
	&__msg-avatar {
		width: 24px; height: 24px;
		border-radius: 50%;
		background: rgba(255,255,255,0.06);
		display: flex; align-items: center; justify-content: center;
		flex-shrink: 0;
		.material-icons-round { font-size: 14px; color: var(--color-complement-text); }
		.chat__msg--user & { background: #56C1F0; .material-icons-round { color: #11182a; } }
	}
	&__msg-bubble {
		padding: 8px 10px;
		border-radius: 6px;
		max-width: 85%;
		line-height: 1.55;
		word-break: break-word;
		.chat__msg--assistant & {
			background: rgba(255,255,255,0.04);
			color: var(--color-normal-text);
		}
		.chat__msg--user & {
			background: rgba(86, 193, 240, 0.15);
			color: var(--color-normal-text);
		}
		:deep(strong) { color: #f5ad4a; }
	}

	&__input-bar {
		display: flex;
		gap: 6px;
		padding: 10px;
		border-top: 1px solid var(--color-border);
		background: rgba(0,0,0,0.18);
	}
	&__input {
		flex: 1;
		background: var(--color-component-background);
		color: var(--color-normal-text);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 6px 10px;
		font-size: 12px;
		font-family: inherit;
		outline: none;
		&:focus { border-color: #56C1F0; }
	}
	&__send {
		background: #56C1F0;
		color: #11182a;
		border: none;
		padding: 0 12px;
		border-radius: 4px;
		cursor: pointer;
		display: flex;
		align-items: center;
		.material-icons-round { font-size: 16px; }
		&:disabled { opacity: 0.4; cursor: not-allowed; }
	}
}
</style>
