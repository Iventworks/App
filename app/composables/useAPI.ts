import type PocketBase from "pocketbase";

export async function useAPI<TReturn>(handler: (api: PocketBase) => TReturn, disableAuthRedirect = false) {

    try {
        if (import.meta.server) {

            const { data } = await useAsyncData(async (nuxtApp) => {
                return handler(nuxtApp.$pb);
            });

            return data.value ?? {
                success: false,
                code: 500,
                message: "Failed to process API request on server.",
                data: null
            } as const

        } else if (import.meta.client) {

            const sessionToken = useCookie("session_token");

            if (!useNuxtApp().$pb.authStore.isValid) {
                if (!disableAuthRedirect) {
                    navigateTo('/auth/login?url=' + encodeURIComponent(useRoute().fullPath));
                }
            }

            return handler(useNuxtApp().$pb);

        } else {
            throw new Error("Unknown environment");
        }
        
    } catch (error) {
        return {
            success: false,
            code: 500,
            message: (error as Error).message ?? "An unknown error occurred.",
            data: null
        } as const;
    }
}