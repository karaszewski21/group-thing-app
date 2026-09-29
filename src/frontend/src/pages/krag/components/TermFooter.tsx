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
    <footer className="w-full flex justify-center my-5 ">
      <button type="button" className="rounded-full border-0 bg-[#1B8168] px-4.5 py-1.75 font-extrabold text-white disabled:opacity-60" onClick={onSignUp}>
        {isLoggedIn ? "＋ Zapisz się na zajęcia" : "Zaloguj się, żeby się zapisać"}
      </button>
    </footer>
  );
}
