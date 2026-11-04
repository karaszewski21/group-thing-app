import { useState } from "react";
import type { AuthTab } from "../../auth/authPaths";
import { gateAction } from "../../utils/actionGate";

/** State for `AuthSheet` on a public page: `guard(fn)` runs `fn` for a
 * logged-in caller and opens the sheet (login tab) for an anonymous one;
 * `open(tab)` opens it directly. `isOpen` is never true once the caller is
 * logged in, so logging in through the sheet closes it in place. */
export function useAccountGate(isLoggedIn: boolean) {
  const [tab, setTab] = useState<AuthTab | null>(null);
  return {
    isOpen: tab !== null && !isLoggedIn,
    tab: tab ?? "login",
    open: (initialTab: AuthTab = "login") => setTab(initialTab),
    close: () => setTab(null),
    guard: <A extends unknown[]>(fn: (...args: A) => void | Promise<void>) =>
      gateAction(isLoggedIn, () => setTab("login"), fn),
  };
}

/** What every public-page action hook needs from the page. */
export interface TermActionDeps {
  isLoggedIn: boolean;
  refetch: () => Promise<void>;
  showToast: (message: string) => void;
}
