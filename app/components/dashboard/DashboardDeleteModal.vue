<script setup lang="ts">
const CONFIRM_WORD = "LÖSCHEN";

interface Props {
	title: string;
	warningText: string;
	open: boolean;
	/** Ask the user to type the confirm word (for destructive actions with lots of data). */
	requireConfirmText?: boolean;
	preventAutoClose?: boolean;
	/** Throw to keep the modal open (e.g. when the API call failed). */
	onDelete: () => Promise<void> | void;
}

const props = withDefaults(defineProps<Props>(), {
	requireConfirmText: true,
	preventAutoClose: false,
});

const emit = defineEmits<{
	"update:open": [value: boolean];
}>();

const confirmText = ref("");
const loading = ref(false);

// Reset the confirmation when the modal closes.
watch(
	() => props.open,
	(open) => {
		if (!open) confirmText.value = "";
	},
);

async function onDeleteWrapper() {
	loading.value = true;
	try {
		await props.onDelete();
		if (!props.preventAutoClose) {
			emit("update:open", false);
		}
	} catch {
		// Keep the modal open; the caller already showed an error toast.
	} finally {
		loading.value = false;
	}
}
</script>

<template>
	<DashboardModal
		:open="open"
		:title="title"
		description="Diese Aktion kann nicht rückgängig gemacht werden."
		icon="i-lucide-alert-triangle"
		icon-color="error"
		@update:open="(value: boolean) => emit('update:open', value)"
	>
		<div class="space-y-4">
			<div class="rounded-lg border border-red-900/50 bg-red-950/50 p-4">
				<p class="text-sm text-red-300">
					<strong>Achtung:</strong>
					{{ warningText }}
				</p>
			</div>

			<div v-if="requireConfirmText">
				<label class="mb-2 block text-sm font-medium text-slate-300">
					Gib <span class="text-red-400">{{ CONFIRM_WORD }}</span> ein, um zu bestätigen
				</label>
				<UInput v-model="confirmText" type="text" :placeholder="CONFIRM_WORD" class="w-full" />
			</div>
		</div>

		<template #footer>
			<div class="flex justify-end gap-3">
				<UButton
					label="Abbrechen"
					color="neutral"
					variant="ghost"
					@click="emit('update:open', false)"
				/>
				<UButton
					:label="title"
					color="error"
					:loading="loading"
					:disabled="requireConfirmText && confirmText !== CONFIRM_WORD"
					icon="i-lucide-trash-2"
					@click="onDeleteWrapper"
				/>
			</div>
		</template>
	</DashboardModal>
</template>
