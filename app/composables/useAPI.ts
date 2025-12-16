import * as apiClient from "@/api-client";

export async function useAPI<TReturn>(handler: (api: typeof apiClient) => TReturn, disableAuthRedirect = false) {

    try {
        if (import.meta.server) {

            const { data } = await useAsyncData(async (nuxtApp) => {

                const sessionToken = useCookie("cmp_session_token");

                sessionToken.value ? updateAPIClient(sessionToken.value) : updateAPIClient(null);

                return handler(apiClient);
            });

            return data.value ?? {
                success: false,
                code: 500,
                message: "Failed to process API request on server.",
                data: null
            } as const

        } else if (import.meta.client) {

            const sessionToken = useCookie("cmp_session_token");

            if (sessionToken.value) {
                updateAPIClient(sessionToken.value);
            } else {
                updateAPIClient(null);
                if (!disableAuthRedirect) {
                    navigateTo('/auth/login?url=' + encodeURIComponent(useRoute().fullPath));
                }
            }

            return handler(apiClient);

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