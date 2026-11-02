/** Sticky sign-up footer. Nothing when the viewer already attends (or there
 * is no Term to attend); otherwise one full-width button, worded by login state. */
export function TermFooter({
  isLoggedIn,
  isAttending,
  busy = false,
  onSignUp,
}: {
  isLoggedIn: boolean;
  isAttending: boolean;
  /** A sign-up request is in flight — the button is disabled meanwhile. */
  busy?: boolean;
  onSignUp: () => void;
}) {
  if (isAttending) return null;
  return (
    <footer className="sticky bottom-0 z-20 mt-6 border-t border-line bg-cream px-5 pt-3.5 pb-5">
      <button
        type="button"
        className="min-h-14 w-full rounded-full border-0 bg-primary px-5 text-[17px] font-extrabold text-on-primary disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        disabled={busy}
        onClick={onSignUp}
      >
        {isLoggedIn ? "＋ Zapisz się na zajęcia" : "Zaloguj się, żeby się zapisać"}
      </button>
    </footer>
  );
}
