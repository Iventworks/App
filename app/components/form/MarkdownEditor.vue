<script setup lang="ts">
/**
 * Markdown editor for notes and announcements (Nuxt UI `UEditor`, content stored as markdown).
 * With `readonly` it renders the markdown without a toolbar — use `<ContentMarkdownView>` for
 * plain display.
 */
import type { EditorToolbarItem } from "@nuxt/ui";

const props = withDefaults(
	defineProps<{
		placeholder?: string;
		readonly?: boolean;
		/** Minimum height of the editable area (Tailwind class). */
		minHeight?: string;
	}>(),
	{
		placeholder: "Schreib etwas …",
		readonly: false,
		minHeight: "min-h-48",
	},
);

const content = defineModel<string>({ default: "" });

const toolbarItems: EditorToolbarItem[][] = [
	[
		{ kind: "heading", level: 2, icon: "i-lucide-heading-2", tooltip: { text: "Überschrift" } },
		{
			kind: "heading",
			level: 3,
			icon: "i-lucide-heading-3",
			tooltip: { text: "Zwischenüberschrift" },
		},
	],
	[
		{ kind: "mark", mark: "bold", icon: "i-lucide-bold", tooltip: { text: "Fett" } },
		{ kind: "mark", mark: "italic", icon: "i-lucide-italic", tooltip: { text: "Kursiv" } },
		{
			kind: "mark",
			mark: "strike",
			icon: "i-lucide-strikethrough",
			tooltip: { text: "Durchgestrichen" },
		},
		{ kind: "link", icon: "i-lucide-link", tooltip: { text: "Link" } },
	],
	[
		{ kind: "bulletList", icon: "i-lucide-list", tooltip: { text: "Liste" } },
		{ kind: "orderedList", icon: "i-lucide-list-ordered", tooltip: { text: "Nummerierte Liste" } },
		{ kind: "taskList", icon: "i-lucide-list-checks", tooltip: { text: "Checkliste" } },
		{ kind: "blockquote", icon: "i-lucide-text-quote", tooltip: { text: "Zitat" } },
	],
	[
		{ kind: "undo", icon: "i-lucide-undo", tooltip: { text: "Rückgängig" } },
		{ kind: "redo", icon: "i-lucide-redo", tooltip: { text: "Wiederholen" } },
	],
];
</script>

<template>
	<div
		:class="[
			'overflow-hidden rounded-lg',
			props.readonly ? '' : 'border border-slate-800 bg-slate-950/40 focus-within:border-primary/60',
		]"
	>
		<UEditor
			v-slot="{ editor }"
			v-model="content"
			content-type="markdown"
			:editable="!props.readonly"
			:placeholder="props.readonly ? undefined : props.placeholder"
			:image="false"
			:mention="false"
			:ui="{
				base: props.readonly ? 'px-0 py-0' : `${props.minHeight} px-4 py-3 sm:px-4`,
			}"
		>
			<UEditorToolbar
				v-if="!props.readonly"
				:editor="editor"
				:items="toolbarItems"
				class="overflow-x-auto border-b border-slate-800 px-2 py-1"
			/>
		</UEditor>
	</div>
</template>
