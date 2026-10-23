import { Link, useLocation } from "react-router-dom";
import { ModalSheet } from "../../../components/shared/ModalSheet";
import { authPath } from "../../../auth/authPaths";
import { BTN_GHOST, BTN_PRIMARY } from "../../../components/shared/uiStyles";

/** The current page as a `returnTo`, so both logging in and registering
 * (via onboarding) bring the visitor back here. The fragment is left out on
 * purpose: inside the query it would reach the server, so a `#code=`
 * survives login through sessionStorage instead (`TermPage`). */
function useReturnTo(): string {
  const location = useLocation();
  return location.pathname + location.search;
}

/**
 * The login / (optional guest) / register choice — the one piece of
 * markup every "you need an account" prompt on the term pages shares.
 * Rendered bare inside a card (`PrivateTermView`) or inside
 * `AuthGateSheet`'s bottom sheet.
 */
export function AuthGateLinks({ onGuest }: { onGuest?: () => void }) {
  const returnTo = useReturnTo();
  return (
    <>
      <Link
        to={authPath("login", returnTo)}
        className={`${BTN_PRIMARY} mb-2.5 block w-full px-3.5 py-2.5 text-center text-[13px]`}
      >
        Zaloguj się
      </Link>

      {onGuest && (
        <button
          className={`${BTN_GHOST} mb-3.5 w-full px-3.5 py-2.5 text-[13px]`}
          onClick={onGuest}
        >
          Zapisz się jako gość
        </button>
      )}

      <p className="text-center text-xs text-ink-soft">
        Nie masz konta?{" "}
        <Link to={authPath("register", returnTo)} className="font-bold text-primary-fg">
          Zarejestruj się
        </Link>
      </p>
    </>
  );
}

/**
 * Bottom sheet shown when an ANONYMOUS visitor on a term page attempts an
 * action that needs (or offers) an account — RSVP, "Ja to przyniosę",
 * "Pożycz"/"Zamień"/"Weź na stałe". `onGuest` adds the "as a guest" path,
 * which only the RSVP flow has. Tailwind for layout/spacing and the
 * shared `uiStyles` buttons, to match the rest of the term page.
 */
export function AuthGateSheet({
  title,
  message,
  ariaLabel,
  onGuest,
  onClose,
}: {
  title: string;
  message: string;
  ariaLabel?: string;
  onGuest?: () => void;
  onClose: () => void;
}) {
  return (
    <ModalSheet title={title} ariaLabel={ariaLabel} onClose={onClose}>
      <p className="mb-4 text-[13px] text-ink-soft">{message}</p>
      <AuthGateLinks onGuest={onGuest} />
    </ModalSheet>
  );
}
