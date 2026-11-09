<script setup lang="ts">
// The admin area has no landing page of its own: open the user management — or, on the system
// host, the organisations.
definePageMeta({
	layout: "dashboard",
	middleware: () =>
		navigateTo(useInstance().value?.kind === "system" ? "/admin/orgs" : "/admin/users", {
			replace: true,
		}),
});
</script>

<template>
	<div />
</template>
