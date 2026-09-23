/** Sticky sign-up footer. Nothing when the viewer already attends (or there
 * is no Term to attend); otherwise one button, worded by login state. */
export function TermFooter({
  isLoggedIn,
  isAttending,
  onSignUp,
}: {
  isLoggedIn: boolean;
  isAttending: boolean;
  onSignUp: () => void;
}) {
  if (isAttending) return null;
  return (
    <footer className="kg-foot">
      <button type="button" className="kg-btn-primary" onClick={onSignUp}>
        {isLoggedIn ? "＋ Zapisz się na zajęcia" : "Zaloguj się, żeby się zapisać"}
      </button>
    </footer>
  );
}
