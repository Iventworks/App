<script setup lang="ts">
/**
 * Compact care indicators for a participant (allergies, medication, diet, medical notes,
 * non-swimmer, no photo consent), each with a tooltip showing the details.
 */
const props = defineProps<{
	participant: {
		allergies: string;
		medications: string;
		dietary_requirements: string;
		medical_notes: string;
		can_swim: boolean | null;
		photo_consent: boolean;
	};
}>();

const indicators = computed(() => {
	const p = props.participant;
	const list: { key: string; icon: string; class: string; text: string }[] = [];
	if (p.allergies.trim()) {
		list.push({
			key: "allergies",
			icon: "i-lucide-shield-alert",
			class: "text-red-400",
			text: `Allergien: ${p.allergies}`,
		});
	}
	if (p.medications.trim()) {
		list.push({
			key: "medications",
			icon: "i-lucide-pill",
			class: "text-amber-400",
			text: `Medikamente: ${p.medications}`,
		});
	}
	if (p.dietary_requirements.trim()) {
		list.push({
			key: "dietary",
			icon: "i-lucide-utensils",
			class: "text-emerald-400",
			text: `Ernährung: ${p.dietary_requirements}`,
		});
	}
	if (p.medical_notes.trim()) {
		list.push({
			key: "medical",
			icon: "i-lucide-stethoscope",
			class: "text-amber-400",
			text: `Medizinische Hinweise: ${p.medical_notes}`,
		});
	}
	if (p.can_swim === false) {
		list.push({
			key: "swim",
			icon: "i-lucide-life-buoy",
			class: "text-amber-400",
			text: "Kann nicht schwimmen",
		});
	}
	if (!p.photo_consent) {
		list.push({
			key: "photo",
			icon: "i-lucide-camera-off",
			class: "text-slate-400",
			text: "Keine Foto-Einwilligung",
		});
	}
	return list;
});
</script>

<template>
	<span class="inline-flex items-center gap-1.5">
		<UTooltip v-for="indicator in indicators" :key="indicator.key" :text="indicator.text">
			<UIcon :name="indicator.icon" :class="['size-4 shrink-0', indicator.class]" />
		</UTooltip>
		<span v-if="!indicators.length" class="text-xs text-slate-600">–</span>
	</span>
</template>
