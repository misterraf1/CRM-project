import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False in the server render and until React has hydrated the page, then true.
 * Submit buttons wait for it: clicked earlier, a form would submit natively (a GET
 * with the fields in the URL) instead of through its handler.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
