<script setup lang="ts">
/**
 * Dialogs of the event finances section (expense form, review, budget item, deletes) plus the
 * hidden receipt input. Rendered once by `/events/[event_id]/finances`; the child pages open them
 * through `useEventFinances()`.
 */
const {
	categoryOptions,
	isImage,
	expenseSchema,
	expenseFormOpen,
	editingExpense,
	savingExpense,
	expenseForm,
	receiptFile,
	onCategoryCreate,
	onReceiptPicked,
	submitExpense,
	replaceInput,
	onReplacePicked,
	canUploadReceipt,
	deleteExpenseTarget,
	deleteExpenseOpen,
	confirmDeleteExpense,
	reviewOpen,
	reviewTarget,
	reviewing,
	reviewForm,
	submitReview,
	budgetSchema,
	budgetFormOpen,
	editingBudgetItem,
	savingBudget,
	budgetForm,
	submitBudgetItem,
	deleteBudgetTarget,
	deleteBudgetOpen,
	confirmDeleteBudgetItem,
} = useEventFinances();

const fileURL = useFileURL();

const cameraInput = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const BUDGET_KIND_OPTIONS = [
	{ label: "Ausgabe", value: "expense" },
	{ label: "Einnahme", value: "income" },
];
</script>

<template>
	<input
		ref="replaceInput"
		type="file"
		accept="image/*,application/pdf"
		class="hidden"
		@change="onReplacePicked"
	/>

	<!-- Expense form -->
	<DashboardModal
		v-model:open="expenseFormOpen"
		:title="editingExpense ? 'Ausgabe bearbeiten' : 'Ausgabe einreichen'"
		:icon="editingExpense ? 'i-lucide-pencil' : 'i-lucide-receipt'"
	>
		<UForm :schema="expenseSchema" :state="expenseForm" class="space-y-4" @submit="submitExpense">
			<UFormField label="Wofür?" name="title" required>
				<UInput v-model="expenseForm.title" placeholder="z. B. Einkauf Grillabend" class="w-full" autofocus />
			</UFormField>

			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Betrag" name="amount" required>
					<UInput v-model="expenseForm.amount" inputmode="decimal" placeholder="0,00" class="w-full">
						<template #trailing><span class="text-sm text-slate-400">€</span></template>
					</UInput>
				</UFormField>
				<UFormField label="Datum" name="spent_on" required>
					<FormDatePicker v-model="expenseForm.spent_on" :max="toDayString()" />
				</UFormField>
			</div>

			<UFormField label="Kategorie" name="category" description="Wähle eine Kategorie oder tippe eine neue ein.">
				<USelectMenu
					v-model="expenseForm.category"
					:items="categoryOptions"
					create-item
					class="w-full"
					@create="onCategoryCreate"
				/>
			</UFormField>

			<UFormField label="Notiz" name="description">
				<UTextarea
					v-model="expenseForm.description"
					:rows="2"
					autoresize
					placeholder="Optional: Details, Zahlungsweg, IBAN-Hinweis …"
					class="w-full"
				/>
			</UFormField>

			<UFormField
				v-if="!editingExpense || canUploadReceipt(editingExpense)"
				label="Beleg"
				:description="
					editingExpense?.receipt
						? 'Ein Beleg ist vorhanden. Ein neuer Beleg ersetzt ihn.'
						: 'Foto oder PDF des Kassenbons (optional, aber nötig für die Erstattung).'
				"
			>
				<div class="flex flex-wrap items-center gap-2">
					<UButton
						label="Foto aufnehmen"
						icon="i-lucide-camera"
						color="neutral"
						variant="subtle"
						class="sm:hidden"
						@click="cameraInput?.click()"
					/>
					<UButton
						label="Datei wählen"
						icon="i-lucide-paperclip"
						color="neutral"
						variant="subtle"
						@click="fileInput?.click()"
					/>
					<span v-if="receiptFile" class="flex min-w-0 items-center gap-1 text-sm text-slate-300">
						<UIcon name="i-lucide-file-check" class="size-4 text-emerald-400" />
						<span class="truncate">{{ receiptFile.name }}</span>
						<UButton
							icon="i-lucide-x"
							color="neutral"
							variant="ghost"
							size="xs"
							aria-label="Beleg entfernen"
							@click="receiptFile = null"
						/>
					</span>
				</div>
				<input
					ref="cameraInput"
					type="file"
					accept="image/*"
					capture="environment"
					class="hidden"
					@change="onReceiptPicked"
				/>
				<input
					ref="fileInput"
					type="file"
					accept="image/*,application/pdf"
					class="hidden"
					@change="onReceiptPicked"
				/>
			</UFormField>

			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="expenseFormOpen = false" />
				<UButton type="submit" :label="editingExpense ? 'Speichern' : 'Einreichen'" :loading="savingExpense" />
			</div>
		</UForm>
	</DashboardModal>

	<!-- Review -->
	<DashboardModal v-model:open="reviewOpen" title="Ausgabe prüfen" icon="i-lucide-scan-search">
		<div v-if="reviewTarget" class="space-y-4">
			<div class="flex gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
				<a
					v-if="reviewTarget.receipt"
					:href="fileURL(reviewTarget.receipt.download_token)"
					target="_blank"
					rel="noopener"
					class="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-800"
				>
					<img
						v-if="isImage(reviewTarget)"
						:src="fileURL(reviewTarget.receipt.download_token)"
						alt="Beleg"
						class="size-full object-cover"
					/>
					<UIcon v-else name="i-lucide-file-text" class="size-8 text-slate-400" />
				</a>
				<div class="min-w-0 flex-1 text-sm">
					<p class="font-medium text-white">{{ reviewTarget.title }}</p>
					<p class="text-slate-400">
						{{ reviewTarget.submitter?.display_name ?? "Unbekannt" }} · {{ formatDay(reviewTarget.spent_on) }} ·
						{{ reviewTarget.category }}
					</p>
					<p class="mt-1 text-lg font-semibold tabular-nums text-white">
						{{ formatCents(reviewTarget.amount_cents) }}
					</p>
					<p v-if="reviewTarget.description" class="mt-1 text-slate-400">{{ reviewTarget.description }}</p>
					<p v-if="!reviewTarget.receipt" class="mt-1 text-amber-400">Es wurde kein Beleg hochgeladen.</p>
				</div>
			</div>

			<UFormField label="Entscheidung">
				<div class="grid gap-2 sm:grid-cols-3">
					<UButton
						v-for="action in EXPENSE_REVIEW_ACTIONS"
						:key="action.status"
						:label="EXPENSE_STATUS_LABELS[action.status]"
						:icon="action.icon"
						:color="reviewForm.status === action.status ? EXPENSE_STATUS_COLORS[action.status] : 'neutral'"
						:variant="reviewForm.status === action.status ? 'solid' : 'outline'"
						block
						@click="reviewForm.status = action.status"
					/>
				</div>
			</UFormField>

			<UFormField
				label="Notiz an die Person"
				:description="reviewForm.status === 'rejected' ? 'Bitte begründe die Ablehnung.' : 'Optional'"
			>
				<UTextarea v-model="reviewForm.note" :rows="2" autoresize class="w-full" />
			</UFormField>

			<div class="flex justify-end gap-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="reviewOpen = false" />
				<UButton label="Speichern" icon="i-lucide-check" :loading="reviewing" @click="submitReview" />
			</div>
		</div>
	</DashboardModal>

	<!-- Budget item form -->
	<DashboardModal
		v-model:open="budgetFormOpen"
		:title="editingBudgetItem ? 'Budgetposten bearbeiten' : 'Neuer Budgetposten'"
		icon="i-lucide-wallet"
	>
		<UForm :schema="budgetSchema" :state="budgetForm" class="space-y-4" @submit="submitBudgetItem">
			<UFormField label="Art" name="kind">
				<USelect v-model="budgetForm.kind" :items="BUDGET_KIND_OPTIONS" class="w-full" />
			</UFormField>
			<UFormField label="Kategorie" name="category" required>
				<UInput
					v-model="budgetForm.category"
					:placeholder="budgetForm.kind === 'income' ? 'z. B. Teilnahmebeiträge' : 'z. B. Lebensmittel'"
					class="w-full"
				/>
			</UFormField>
			<UFormField label="Geplanter Betrag" name="planned" required>
				<UInput v-model="budgetForm.planned" inputmode="decimal" placeholder="0,00" class="w-full">
					<template #trailing><span class="text-sm text-slate-400">€</span></template>
				</UInput>
			</UFormField>
			<UFormField label="Beschreibung" name="description">
				<UTextarea v-model="budgetForm.description" :rows="2" autoresize class="w-full" />
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="budgetFormOpen = false" />
				<UButton type="submit" :label="editingBudgetItem ? 'Speichern' : 'Anlegen'" :loading="savingBudget" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteExpenseOpen"
		title="Ausgabe löschen"
		:warning-text="`Die Ausgabe „${deleteExpenseTarget?.title}“ und ihr Beleg werden gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDeleteExpense"
	/>

	<DashboardDeleteModal
		v-model:open="deleteBudgetOpen"
		title="Budgetposten löschen"
		:warning-text="`Der Posten „${deleteBudgetTarget?.category}“ wird gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDeleteBudgetItem"
	/>
</template>
