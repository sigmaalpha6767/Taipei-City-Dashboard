<script setup>
const props = defineProps({
	roles: { type: Object, required: true },  // { health: {...}, parent: {...}, ... }
	activeRole: { type: String, required: true },
});
const emits = defineEmits(["change"]);

const ICON_MAP = {
	"medical_services": "medical_services",
	"school": "school",
	"family_restroom": "family_restroom",
	"store": "store",
};
</script>

<template>
	<div class="roles">
		<button
			v-for="(role, key) in roles"
			:key="key"
			class="roles__btn"
			:class="{ 'roles__btn--active': activeRole === key }"
			:style="activeRole === key ? { borderColor: role.color, color: role.color } : {}"
			@click="emits('change', key)"
		>
			<span class="material-icons-round">{{ ICON_MAP[role.icon] || 'person' }}</span>
			<span>{{ role.label }}</span>
		</button>
	</div>
</template>

<style scoped lang="scss">
.roles {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	padding: 4px 0;

	&__btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 16px;
		background: rgba(255, 255, 255, 0.04);
		color: var(--color-complement-text);
		border: 1.5px solid var(--color-border);
		border-radius: 20px;
		font-size: 13px;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.18s;

		.material-icons-round {
			font-size: 16px;
		}

		&:hover {
			background: rgba(255, 255, 255, 0.08);
			color: var(--color-normal-text);
		}

		&--active {
			background: rgba(86, 193, 240, 0.08);
			font-weight: 600;
		}
	}
}
</style>
