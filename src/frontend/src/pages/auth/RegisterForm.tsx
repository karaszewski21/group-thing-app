import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, type RegisterPayload } from "../../auth/AuthContext";
import { authPath } from "../../auth/authPaths";
import { AUTH_INPUT, AUTH_LABEL, AUTH_SUBMIT } from "../../components/layout/authStyles";

const DUPLICATE_EMAIL_MESSAGE = "Ten email jest już zarejestrowany, zaloguj się";

/** The "Załóż konto" tab of `/login` (LoginPage). */
export function RegisterForm() {
  const [role, setRole] = useState<RegisterPayload["role"]>("GUEST");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Carried through onboarding (and onto the login tab link) so a visitor
  // who came from a term page's account gate lands back on it.
  const returnTo = searchParams.get("returnTo");
  const returnToQuery = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";

  const isOrganizer = role === "ORGANIZER";
  const canSubmit = Boolean(role && email && password && !loading);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register({ role, email, password });
      navigate(`/onboarding${returnToQuery}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zarejestrować");
    } finally {
      setLoading(false);
    }
  }

  const roleTile = (on: boolean) =>
    `min-h-12 flex-1 rounded-2xl px-3 text-[15px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
      on ? "border-2 border-primary bg-primary-soft font-extrabold text-primary-fg" : "border-[1.5px] border-line bg-paper text-ink-soft hover:text-ink"
    }`;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <span className={AUTH_LABEL}>Kim jesteś?</span>
        <div className="flex gap-2">
          <button type="button" aria-pressed={role === "GUEST"} onClick={() => setRole("GUEST")} className={roleTile(role === "GUEST")}>
            Gość
          </button>
          <button
            type="button"
            aria-pressed={isOrganizer}
            onClick={() => setRole("ORGANIZER")}
            className={roleTile(isOrganizer)}
          >
            Organizator
          </button>
        </div>
        <p className="mt-2 text-[13px] leading-snug text-ink-soft">
          {isOrganizer
            ? "Zorganizuj się po swojemu – twórz grupy i planuj terminy w kilka chwil."
            : "Dołączysz jako rodzina — własną grupę możesz założyć później z panelu."}
        </p>
      </div>

      <div>
        <label htmlFor="email" className={AUTH_LABEL}>
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ty@przyklad.pl"
          className={AUTH_INPUT}
        />
      </div>

      <div>
        <label htmlFor="password" className={AUTH_LABEL}>
          Hasło
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Wpisz hasło"
          className={AUTH_INPUT}
        />
      </div>

      {error && (
        <div role="alert" className="rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
          {error === DUPLICATE_EMAIL_MESSAGE && (
            <>
              {" "}
              <Link to={authPath("login", returnTo)} className="font-semibold underline">
                Zaloguj się
              </Link>
            </>
          )}
        </div>
      )}

      <button type="submit" disabled={!canSubmit} className={`mt-1 ${AUTH_SUBMIT}`}>
        {loading ? "Zakładanie konta…" : "Załóż konto"}
      </button>
    </form>
  );
}
