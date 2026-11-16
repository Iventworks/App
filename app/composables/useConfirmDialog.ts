import DashboardConfirmModal from "~/components/dashboard/DashboardConfirmModal.vue";

type Color = "primary" | "error" | "warning" | "neutral";

export interface ConfirmDialogOptions {
	title: string;
	description?: string;
	icon?: string;
	iconColor?: Color;
	confirmLabel?: string;
	confirmColor?: Color;
	confirmIcon?: string;
	alternativeLabel?: string;
	alternativeColor?: Color;
	cancelLabel?: string;
}

export type ConfirmDialogChoice = "confirm" | "alternative" | "cancel";

/**
 * Ask a question in a modal (never `window.confirm`). Call it in `setup`; the returned function
 * resolves to the button that was clicked — Escape or clicking outside give `"cancel"`. Works in
 * route guards: `onBeforeRouteLeave(async () => (await ask({ … })) === "confirm")`.
 */
export function useConfirmDialog() {
	const overlay = useOverlay();

	return async (options: ConfirmDialogOptions): Promise<ConfirmDialogChoice> => {
		const modal = overlay.create(DashboardConfirmModal, { destroyOnClose: true });
		const choice = await modal.open(options);
		return choice === "confirm" || choice === "alternative" ? choice : "cancel";
	};
}

/**
 * "Unsaved changes" before switching or leaving: resolves to `"save"`, `"discard"` or `"cancel"`.
 * Without a save option (`canSave: false`) it only offers discarding.
 */
export function useUnsavedChangesDialog() {
	const ask = useConfirmDialog();

	return async (
		description = "Deine Änderungen gehen verloren, wenn du sie nicht speicherst.",
		options: { canSave?: boolean } = {},
	): Promise<"save" | "discard" | "cancel"> => {
		const canSave = options.canSave ?? true;
		const choice = await ask({
			title: "Ungespeicherte Änderungen",
			description,
			icon: "i-lucide-circle-alert",
			iconColor: "warning",
			cancelLabel: "Weiter bearbeiten",
			...(canSave
				? {
						confirmLabel: "Speichern",
						confirmIcon: "i-lucide-save",
						alternativeLabel: "Verwerfen",
						alternativeColor: "error" as const,
					}
				: { confirmLabel: "Verwerfen", confirmColor: "error" as const }),
		});
		if (choice === "cancel") return "cancel";
		if (!canSave) return "discard";
		return choice === "confirm" ? "save" : "discard";
	};
}
