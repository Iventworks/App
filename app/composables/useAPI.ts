import type { TypedPocketBase } from '~/types/pocketbase';

export async function useAPI<TReturn>(handler: (api: TypedPocketBase) => TReturn, disableAuthRedirect = false) {
    if (import.meta.server) {

        const { data } = await useAsyncData(async (nuxtApp) => {
            return handler(nuxtApp.$pb);
        });

        return data.value as TReturn;

    } else if (import.meta.client) {

        if (!useNuxtApp().$pb.authStore.isValid) {
            if (!disableAuthRedirect) {
                navigateTo('/auth/login?url=' + encodeURIComponent(useRoute().fullPath));
            }
        }

        return handler(useNuxtApp().$pb);

    } else {
        throw new Error("Unknown environment");
    }
}