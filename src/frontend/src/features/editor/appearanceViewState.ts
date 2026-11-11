/** The one screen `/:slug/appearance` shows. `notFound` and `error` are
 * handed to the route's `not-found.tsx` and `error.tsx`. */
export type AppearanceView<Owner> =
  | { kind: "login" }
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error"; message: string }
  | { kind: "content"; owner: Owner };

export const APPEARANCE_LOAD_ERROR = "Nie udało się wczytać ustawień strony.";

/** A failed owner read, thrown by an appearance page to the route's
 * `error.tsx`, which shows its message. */
export class AppearanceLoadError extends Error {}

interface AppearancePageState<Owner> {
  loggedIn: boolean;
  /** The caller's own Organization or profile read. */
  loading: boolean;
  error: string | null;
  /** That read when it is the page in the URL, else `null`. */
  owner: Owner | null;
}

/** First match wins: a visitor logs in first; the editor opens only on the
 * caller's own page, anyone else's (or none) is not found, so the route
 * never reveals whose page it is. */
export function resolveAppearanceView<Owner>({
  loggedIn,
  loading,
  error,
  owner,
}: AppearancePageState<Owner>): AppearanceView<Owner> {
  if (!loggedIn) return { kind: "login" };
  if (owner) return { kind: "content", owner };
  if (loading) return { kind: "loading" };
  if (error) return { kind: "error", message: APPEARANCE_LOAD_ERROR };
  return { kind: "notFound" };
}
