<script setup lang="ts">
// The admin area has no landing page of its own: open the user management.
definePageMeta({
	layout: "dashboard",
	middleware: () => navigateTo("/admin/users", { replace: true }),
});
</script>

<template>
	<div />
</template>
