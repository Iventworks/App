import { reactive } from "vue";
import { useAPI } from "~/composables/useAPI";
import type { UsersRecord } from "~/types/pocketbase";

type UserInfo = UsersRecord;

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
            const record_id = api.authStore.record?.id;
            if (!record_id) {
                return null;
            }
            return api.collection('users').getOne(record_id);
        });
        if (result) {
            this.set(result);
        }
    }

    static clear() {
        for (const key in this.userInfo) {
            delete (this.userInfo as any)[key];
        }
    }

}