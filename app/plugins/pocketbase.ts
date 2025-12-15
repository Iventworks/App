// plugins/pocketbase.js
import PocketBase from 'pocketbase';

export default defineNuxtPlugin(async () => {
  const pb = new PocketBase('https://api.crossover.is-on.net');

  const cookie = useCookie('pb_auth', {
    path:     '/',
    secure:   true,
    sameSite: 'strict',
    httpOnly: false, // change to "true" if you want only server-side access
    maxAge:   604800,
  })

  // load the store data from the cookie value
  pb.authStore.save((cookie.value as any)?.token, (cookie.value as any)?.record);

  // send back the default 'pb_auth' cookie to the client with the latest store state
  pb.authStore.onChange(() => {//@ts-ignore
    cookie.value = {
      token: pb.authStore.token,
      record: pb.authStore.record,
    };
  });

  try {
      // get an up-to-date auth store state by verifying and refreshing the loaded auth model (if any)
      pb.authStore.isValid && await pb.collection('users').authRefresh();
  } catch (_) {
      // clear the auth store on failed refresh
      pb.authStore.clear();
  }

  return {
    provide: { pb }
  }
});