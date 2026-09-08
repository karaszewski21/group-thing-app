import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { mergeAnonymousProfile } from "../../api/groups";
import { useAuth } from "../../auth/AuthContext";

const DEFAULT_ERROR_MESSAGE = "Nie udało się założyć konta — spróbuj ponownie";

/**
 * Mockup 10 (`account-merge-trigger`): a two-field (email + password)
 * inline mini-form — deliberately NOT the full `RegisterPage.tsx` (no
 * GUEST/ORGANIZER role toggle, since this merges an already-anonymous
 * GUEST profile into a real account rather than choosing a fresh role).
 * Rendered by `KragGrupyPage.tsx` in place of a needed item's "Zgłoś się"
 * pledge-trigger, not as a modal/overlay — see §4/§3a of spec.md.
 */
export function AccountMergeForm({ userProfileId }: { userProfileId: number }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const auth = useAuth();
  const navigate = useNavigate();

  async function handleSubmit() {
    if (!email.trim() || !password) {
      setFormError("Podaj email i hasło");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const { token } = await mergeAnonymousProfile({
        user_profile_id: userProfileId,
        email: email.trim(),
        password,
      });
      auth.applyExternalToken(token);
      navigate("/panel");
    } catch (err) {
      // Failure (409 duplicate-email or already-merged) shows an inline
      // message without clearing "guest_profile_id" — the RSVP state
      // stays intact so the visitor can retry.
      if (err instanceof ApiError && err.body && typeof err.body === "object" && "message" in err.body) {
        setFormError(String((err.body as { message?: unknown }).message ?? DEFAULT_ERROR_MESSAGE));
      } else {
        setFormError(DEFAULT_ERROR_MESSAGE);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kg-fulfill" role="form" aria-label="Załóż konto, aby pożyczać i wypożyczać rzeczy">
      <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
        Załóż konto, aby pożyczać i wypożyczać rzeczy
      </p>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 10 }}>
        Twoje zapisanie na zajęcia zostanie zachowane.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        <label htmlFor="merge-email" style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-soft)" }}>
          Email
        </label>
        <input
          id="merge-email"
          className="kg-input"
          type="email"
          placeholder="ania@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        <label htmlFor="merge-password" style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-soft)" }}>
          Hasło
        </label>
        <input
          id="merge-password"
          className="kg-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {formError && <div style={{ color: "#B4443A", fontSize: 12, marginBottom: 10 }}>{formError}</div>}

      <button className="kg-btn-primary" disabled={busy} onClick={() => void handleSubmit()}>
        Załóż konto
      </button>
    </div>
  );
}
