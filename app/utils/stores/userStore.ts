import { reactive } from "vue";
import type { GetAccountResponses } from "@/api-client/types.gen";

type UserInfo = GetAccountResponses["200"]["data"];

export class UserStore {

    private static readonly userInfo = reactive<UserInfo>({} as any);

    static async use() {
        if (!this.userInfo.id) {
            await this.fetchAndSet();
        }
        return this.userInfo;
    }

    static async fetchAndSetIfNeeded() {
        if (!this.userInfo.id) {
            await this.fetchAndSet();
        }
    }

    static set(userInfo: UserInfo) {
        for (const key in userInfo) {
            (this.userInfo as any)[key] = (userInfo as any)[key];
        }
    }

    static async fetchAndSet() {
        const result = await useAPI((api) => {
            return api.getAccount({});
        });
        if (result.success) {
            this.set(result.data);
        }
    }

    static clear() {
        for (const key in this.userInfo) {
            delete (this.userInfo as any)[key];
        }
    }

}