<script setup lang="ts">
/**
 * A form for people without an account (`/s/form/<token>`, the link and QR code of a published form):
 * fill it in and send it, then a thank-you with the option to send another answer. A closed form
 * only says so.
 */

import type { PublicForm } from "~/utils/forms";
import type { FormAnswers } from "~~/server/lib/forms/fields";

definePageMeta({ layout: "public" });

const route = useRoute();
const toast = useToast();
const token = String(route.params.token ?? "");

const form = ref<PublicForm | null>(null);
const notFound = ref(false);

const result = await useAPI((api) => api.getPublicFormsByToken({ path: { token } }), true);
if (result.success) form.value = result.data;
else notFound.value = true;

useSeoMeta({
	title: () => form.value?.title ?? "Formular",
	robots: "noindex, nofollow",
});

const fill = ref<{ reset: () => void } | null>(null);
const sending = ref(false);
const confirmation = ref<string | null>(null);
/** The honeypot: hidden from people, filled in by bots. */
const website = ref("");

async function send(answers: FormAnswers.Answers) {
	sending.value = true;
	const response = await useAPI(
		(api) =>
			api.postPublicFormsByTokenResponses({
				path: { token },
				body: { answers, ...(website.value ? { website: website.value } : {}) },
			}),
		true,
	);
	sending.value = false;
	if (response.success) {
		confirmation.value = response.data.confirmation_message;
		window.scrollTo({ top: 0, behavior: "smooth" });
		return;
	}
	const code = response.code as number;
	if (code === 409 && form.value) {
		form.value = { ...form.value, accepting: false, fields: [] };
		return;
	}
	toast.add({
		title: "Senden fehlgeschlagen",
		description:
			code === 429
				? "Von hier kamen gerade sehr viele Antworten. Bitte versuch es in ein paar Minuten noch einmal."
				: code === 400
					? "Bitte prüfe deine Antworten."
					: "Bitte versuch es noch einmal.",
		color: "error",
	});
}

function again() {
	confirmation.value = null;
	fill.value?.reset();
	window.scrollTo({ top: 0 });
}
</script>

<template>
	<div class="mx-auto w-full max-w-2xl">
		<SharesNotFound
			v-if="notFound || !form"
			title="Formular nicht gefunden"
			description="Der Link ist falsch oder das Formular gibt es nicht mehr."
		/>

		<template v-else>
			<header class="mb-6 space-y-3">
				<h1 class="text-2xl font-bold text-white sm:text-3xl">{{ form.title }}</h1>
				<ContentMarkdownView v-if="form.description && !confirmation" :content="form.description" />
			</header>

			<UCard v-if="confirmation" class="border-slate-800 bg-slate-900/60">
				<div class="flex flex-col items-center gap-4 py-6 text-center">
					<UIcon name="i-lucide-circle-check" class="size-12 text-emerald-400" />
					<p class="whitespace-pre-line text-lg text-white">{{ confirmation }}</p>
					<UButton label="Weitere Antwort senden" icon="i-lucide-rotate-ccw" color="neutral" variant="ghost" @click="again" />
				</div>
			</UCard>

			<UCard v-else-if="!form.accepting" class="border-slate-800 bg-slate-900/60">
				<div class="flex flex-col items-center gap-3 py-6 text-center">
					<UIcon name="i-lucide-lock" class="size-10 text-amber-400" />
					<p class="text-lg text-white">Dieses Formular nimmt keine Antworten mehr an.</p>
				</div>
			</UCard>

			<template v-else>
				<FormsFill ref="fill" :fields="form.fields" :submitting="sending" @submit="send" />
				<div class="absolute -left-[9999px] size-px overflow-hidden" aria-hidden="true">
					<label>
						Website
						<input v-model="website" name="website" tabindex="-1" autocomplete="off" />
					</label>
				</div>
			</template>
		</template>
	</div>
</template>
