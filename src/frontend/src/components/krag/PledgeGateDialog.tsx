import { Link } from "react-router-dom";

/**
 * Shown when an ANONYMOUS visitor on the public term page taps
 * "Ja to przyniosę" on a needed item. Unlike `RsvpGateDialog` there is no
 * "as a guest" path — a pledge needs a real party, so the only ways forward
 * are logging in or registering. `.kg-*` tokens / inline styles, matching
 * the rest of this page (off Tailwind per `frontend/css.md`).
 */
export function PledgeGateDialog({
  loginHref,
  registerHref,
  onClose,
}: {
  loginHref: string;
  registerHref: string;
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
        aria-label="Załóż konto, aby przynieść rzecz"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          background: "var(--paper)",
          borderRadius: "24px 24px 0 0",
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <h3 style={{ fontFamily: "Fraunces,Georgia,serif", fontSize: 18, fontWeight: 600 }}>
            Potrzebne konto
          </h3>
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

        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 16 }}>
          Żeby zgłosić, że przyniesiesz coś na zajęcia, musisz mieć konto — dzięki temu
          organizator wie, kto co przynosi, a rzecz trafia do Twoich zbiorów.
        </p>

        <Link
          to={loginHref}
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

        <p style={{ fontSize: 12, color: "var(--ink-soft)", textAlign: "center" }}>
          Nie masz konta?{" "}
          <Link to={registerHref} style={{ fontWeight: 700, color: "var(--mint, #1b8168)" }}>
            Zarejestruj się
          </Link>
        </p>
      </div>
    </div>
  );
}
