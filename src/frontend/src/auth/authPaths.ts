export type AuthTab = "login" | "register";

/** `/login`'s query param that opens the "Załóż konto" tab. */
export const AUTH_TAB_PARAM = "tryb";
export const REGISTER_TAB_VALUE = "rejestracja";

/** The URL of the login / register page (`/login`, one page with two tabs),
 * optionally on the "Załóż konto" tab and carrying a `?returnTo=`. */
export function authPath(tab: AuthTab = "login", returnTo?: string | null): string {
  const params = new URLSearchParams();
  if (tab === "register") params.set(AUTH_TAB_PARAM, REGISTER_TAB_VALUE);
  if (returnTo) params.set("returnTo", returnTo);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}
