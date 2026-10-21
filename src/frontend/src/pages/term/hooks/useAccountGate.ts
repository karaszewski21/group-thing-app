import { useState } from "react";
import { gateAction } from "../../../utils/actionGate";

/** The login/register sheet shared by the term page's account-requiring
 * actions: `guard(fn)` runs `fn` for a logged-in caller and opens the sheet
 * for an anonymous one. `isOpen` is never true once the caller is logged in. */
export function useAccountGate(isLoggedIn: boolean) {
  const [open, setOpen] = useState(false);
  return {
    isOpen: open && !isLoggedIn,
    close: () => setOpen(false),
    guard: <A extends unknown[]>(fn: (...args: A) => void | Promise<void>) =>
      gateAction(isLoggedIn, () => setOpen(true), fn),
  };
}

/** What every term-page action hook needs from the page. */
export interface TermActionDeps {
  isLoggedIn: boolean;
  refetch: () => Promise<void>;
  showToast: (message: string) => void;
}
