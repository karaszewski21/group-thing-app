/** Generic action-gate wrapper — the single mechanism EVERY action handler
 * on the term page (take, propose swap, accept, reject, confirm, pledge,
 * ...) routes through, on either `KragGrupyPage` (private) or
 * `PublicKragGrupyView` (public). Generalizes the earlier ad-hoc
 * `showTakeGate`/`handlePublicTake` pattern: when `isLoggedIn` is false,
 * calling the wrapped function opens the caller's login/register gate
 * dialog instead of running `fn` — no API call happens. Group 7's new
 * actions (propose swap / accept / reject / confirm-race) register through
 * this same wrapper. */
export function gateAction<A extends unknown[]>(
  isLoggedIn: boolean,
  openGate: () => void,
  fn: (...args: A) => void | Promise<void>,
): (...args: A) => void {
  return (...args: A) => {
    if (!isLoggedIn) {
      openGate();
      return;
    }
    void fn(...args);
  };
}
