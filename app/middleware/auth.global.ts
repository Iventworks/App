import { useUserInfoStore } from "~/composables/stores/useUserStore";

export default defineNuxtRouteMiddleware(async (to) => {

    const token = useCookie("cmp_session_token").value;

    if (to.path.startsWith('/auth')) {
        if (!token) {
            return;
        }

        await useUserInfoStore().refreshIfNeeded();

        return navigateTo('/');
    }

    if (!token) {
        return navigateTo('/auth/login?url=' + encodeURIComponent(to.fullPath));
    }

    const user = await useUserInfoStore().use();

    if (to.path.startsWith('/dashboard/admin')) {
        // Check admin access
        if (!user.value || user.value.role !== 'admin') {
            return navigateTo('/dashboard');
        }
    }
});