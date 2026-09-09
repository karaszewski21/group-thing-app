import { Link } from "react-router-dom";

/**
 * Intermediate choice shown when an ANONYMOUS visitor taps
 * "＋ Zapisz się na zajęcia": offers logging in / registering (so the
 * attendance attaches to a real account) OR continuing as a guest. Never
 * shown to a logged-in user — they go straight to `RsvpDialogLoggedIn`.
 * `.kg-*` tokens / inline styles, matching `RsvpDialog` (this page stays
 * off Tailwind per `frontend/css.md`).
 */
export function RsvpGateDialog({
  loginHref,
  registerHref,
  onGuest,
  onClose,
}: {
  loginHref: string;
  registerHref: string;
  onGuest: () => void;
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
        aria-label="Zapisz się na zajęcia"
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
          <h3 style={{ fontFamily: "Fraunces,Georgia,serif", fontSize: 18, fontWeight: 600 }}>
            Zapisz się na zajęcia
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
          Zaloguj się, żeby zapis trafił na Twoje konto — albo zapisz się jako gość.
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

        <button
          className="kg-btn-ghost"
          style={{ width: "100%", padding: "10px 14px", fontSize: 13, marginBottom: 14 }}
          onClick={onGuest}
        >
          Zapisz się jako gość
        </button>

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
