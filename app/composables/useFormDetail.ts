import type { InjectionKey } from "vue";
import type { PutFormsByFormIdData } from "~/api-client";
import type { FormDetails, FormField } from "~/utils/forms";

export type FormChanges = NonNullable<PutFormsByFormIdData["body"]>;

export interface FormDetail {
	formId: number;
	/** The form, loaded by the parent page (the children render only once it is there). */
	form: Ref<FormDetails>;
	/** The list it belongs to (`/core-team/forms`, `/events/3/forms`); the form is below it. */
	listPath: string;
	basePath: string;
	isTemplate: ComputedRef<boolean>;
	/** Kernteam: may save a form as a template. */
	canManageTemplates: boolean;
	/** Unsaved edits on the open tab (the header asks before publishing). */
	dirty: Ref<boolean>;
	/** The form was just deleted: leaving its pages doesn't ask about unsaved edits. */
	deleted: Ref<boolean>;
	/** The questions as they are being edited, for the preview; null: the saved ones. */
	draftFields: Ref<FormField[] | null>;
	refresh: () => Promise<void>;
	save: (changes: FormChanges) => Promise<boolean>;
	setStatus: (status: "open" | "closed") => Promise<boolean>;
}

const KEY: InjectionKey<FormDetail> = Symbol("form-detail");

/**
 * One form's pages (Fragen / Einstellungen / Antworten, in the Kernteam area and in events): the
 * parent page loads the form with this and hands it to `provideFormDetail` (after the `await`, at
 * the top of its setup); the tabs use it through `useFormDetail()`. When the form can't be loaded
 * it returns the HTTP status instead (403: not for this person; the parent shows the error).
 */
export async function createFormDetail(options: {
	formId: number;
	listPath: string;
	canManageTemplates: boolean;
}): Promise<FormDetail | number> {
	const toast = useToast();
	let status = 404;

	async function load() {
		const result = await useAPI((api) => api.getFormsByFormId({ path: { formId: options.formId } }));
		if (!result.success) status = result.code as number;
		return result.success ? result.data : null;
	}

	const initial = await load();
	if (!initial) return status;
	const form = ref(initial) as Ref<FormDetails>;

	async function refresh() {
		const fresh = await load();
		if (fresh) form.value = fresh;
	}

	async function save(changes: FormChanges) {
		const result = await useAPI((api) =>
			api.putFormsByFormId({ path: { formId: options.formId }, body: changes }),
		);
		if (!result.success) {
			toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
			return false;
		}
		form.value = result.data;
		return true;
	}

	async function setStatus(status: "open" | "closed") {
		const result = await useAPI((api) =>
			api.putFormsByFormIdStatus({ path: { formId: options.formId }, body: { status } }),
		);
		if (!result.success) {
			toast.add({
				title: "Status konnte nicht geändert werden",
				description: result.message,
				color: "error",
			});
			return false;
		}
		form.value = result.data;
		return true;
	}

	const detail: FormDetail = {
		formId: options.formId,
		form,
		listPath: options.listPath,
		basePath: `${options.listPath}/${options.formId}`,
		isTemplate: computed(() => form.value.scope === "template"),
		canManageTemplates: options.canManageTemplates,
		dirty: ref(false),
		deleted: ref(false),
		draftFields: ref(null),
		refresh,
		save,
		setStatus,
	};
	return detail;
}

export function provideFormDetail(detail: FormDetail) {
	provide(KEY, detail);
}

export function useFormDetail(): FormDetail {
	const detail = inject(KEY, null);
	if (!detail) throw new Error("useFormDetail() needs createFormDetail() in the parent page");
	return detail;
}
