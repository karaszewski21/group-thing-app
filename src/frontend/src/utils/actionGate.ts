/** Action-gate wrapper for `PublicTermView`'s account-requiring actions
 * (take, propose swap, pledge): when `isLoggedIn` is false, calling the
 * wrapped function opens the caller's login/register gate instead of
 * running `fn` — no API call happens. */
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
