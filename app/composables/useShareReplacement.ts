import type { PublicShareItem } from "~/utils/types";

/**
 * "Neue Fassung hochladen" through a document share link: `pick(item)` opens the file dialog of
 * the hidden `input` (bind it with `ref` and `@change="onPicked"`), `onPicked` uploads the chosen
 * file as the item's new contents and calls `onDone` after a success.
 */
export function useShareReplacement(token: string, onDone: () => Promise<void> | void) {
	const toast = useToast();
	const input = ref<HTMLInputElement | null>(null);
	const target = ref<PublicShareItem | null>(null);
	const replacing = ref(false);

	function pick(item: PublicShareItem) {
		target.value = item;
		input.value?.click();
	}

	async function onPicked(event: Event) {
		const element = event.target as HTMLInputElement;
		const file = element.files?.[0];
		element.value = "";
		const item = target.value;
		if (!file || !item) return;
		replacing.value = true;
		const result = await useAPI(
			(api) =>
				api.putPublicDocsByTokenFilesByFileIdContent({
					path: { token, fileId: item.id },
					body: { file },
				}),
			true,
		);
		replacing.value = false;
		if (!result.success) {
			toast.add({ title: "Ersetzen fehlgeschlagen", description: result.message, color: "error" });
			return;
		}
		toast.add({
			title: `Neue Fassung von „${item.name}“ hochgeladen`,
			icon: "i-lucide-check",
			color: "success",
		});
		await onDone();
	}

	return { input, replacing, pick, onPicked };
}
