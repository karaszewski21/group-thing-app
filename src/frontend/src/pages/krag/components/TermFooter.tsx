/** Sticky sign-up footer. Nothing when the viewer already attends (or there
 * is no Term to attend); otherwise one button, worded by login state. */
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
    <footer className="w-full flex justify-center my-5 ">
      <button type="button" className="rounded-full border-0 bg-primary px-4.5 py-1.75 font-extrabold text-on-primary disabled:opacity-60" disabled={busy} onClick={onSignUp}>
        {isLoggedIn ? "＋ Zapisz się na zajęcia" : "Zaloguj się, żeby się zapisać"}
      </button>
    </footer>
  );
}
