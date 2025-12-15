import { UserStore } from "~/utils/stores/userStore";

export default defineNuxtRouteMiddleware(async(to) => {

    const isAuthenticated = useNuxtApp().$pb.authStore.isValid;

    if (to.path.startsWith('/auth')) {
        if (!isAuthenticated) {
            return;
        }

        await UserStore.fetchAndSetIfNeeded();

        return navigateTo('/');
    }

    if (!isAuthenticated) {
        return navigateTo('/auth/login?url=' + encodeURIComponent(to.fullPath));
    }

    await UserStore.fetchAndSetIfNeeded();
});