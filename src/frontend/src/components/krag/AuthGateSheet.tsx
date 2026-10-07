import { Link, useLocation } from "react-router-dom";
import { ModalSheet } from "./ModalSheet";

/** `?returnTo=` query for the current page, so both logging in and
 * registering (via onboarding) bring the visitor back here. */
function useReturnToQuery(): string {
  const location = useLocation();
  return `?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
}

/**
 * The login / (optional guest) / register choice — the one piece of
 * markup every "you need an account" prompt on the term pages shares.
 * Rendered bare inside a card (`PrivateGroupGate`) or inside
 * `AuthGateSheet`'s bottom sheet.
 */
export function AuthGateLinks({ onGuest }: { onGuest?: () => void }) {
  const returnToQuery = useReturnToQuery();
  return (
    <>
      <Link
        to={`/login${returnToQuery}`}
        className="kg-btn-primary mb-2.5 block w-full px-3.5 py-2.5 text-center text-[13px]"
      >
        Zaloguj się
      </Link>

      {onGuest && (
        <button
          className="kg-btn-ghost mb-3.5 w-full px-3.5 py-2.5 text-[13px]"
          onClick={onGuest}
        >
          Zapisz się jako gość
        </button>
      )}

      <p className="text-center text-xs text-ink-soft">
        Nie masz konta?{" "}
        <Link to={`/register${returnToQuery}`} className="font-bold text-primary-fg">
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
 * which only the RSVP flow has. Tailwind for layout/spacing, `.kg-btn-*`
 * shared button classes to match the rest of the term page.
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
