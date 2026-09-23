import { Link, useLocation } from "react-router-dom";

/** `?returnTo=` query for the current page, so both logging in and
 * registering (via onboarding) bring the visitor back here. */
function useReturnToQuery(): string {
  const location = useLocation();
  return `?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
}

/**
 * The login / (optional guest) / register choice — the one piece of
 * markup every "you need an account" prompt on the term pages shares.
 * Rendered bare inside a card (`PrivateGroupAccessDenied`) or inside
 * `AuthGateSheet`'s bottom sheet.
 */
export function AuthGateLinks({ onGuest }: { onGuest?: () => void }) {
  const returnToQuery = useReturnToQuery();
  return (
    <>
      <Link
        to={`/login${returnToQuery}`}
        className="kg-btn-primary"
        style={{
          display: "block",
          textAlign: "center",
          width: "100%",
          padding: "11px 14px",
          fontSize: 13,
          marginBottom: 10,
        }}
      >
        Zaloguj się
      </Link>

      {onGuest && (
        <button
          className="kg-btn-ghost"
          style={{ width: "100%", padding: "10px 14px", fontSize: 13, marginBottom: 14 }}
          onClick={onGuest}
        >
          Zapisz się jako gość
        </button>
      )}

      <p style={{ fontSize: 12, color: "var(--ink-soft)", textAlign: "center" }}>
        Nie masz konta?{" "}
        <Link to={`/register${returnToQuery}`} style={{ fontWeight: 700, color: "var(--mint, #1b8168)" }}>
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
 * which only the RSVP flow has. `.kg-*` tokens / inline styles, matching
 * the rest of the term page (off Tailwind per `frontend/css.md`).
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
    <div
      className="kg-modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(20,28,24,0.55)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          background: "var(--paper)",
          borderRadius: "24px 24px 0 0",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ fontFamily: "Fraunces,Georgia,serif", fontSize: 18, fontWeight: 600 }}>{title}</h3>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{
              border: "none",
              background: "var(--cream)",
              color: "var(--ink-soft)",
              borderRadius: "50%",
              width: 34,
              height: 34,
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 16 }}>{message}</p>

        <AuthGateLinks onGuest={onGuest} />
      </div>
    </div>
  );
}
