import { useId, useState, type FormEvent } from "react";
import { useAuth, type RegisterPayload } from "../../auth/AuthContext";
import { AUTH_INPUT, AUTH_LABEL, AUTH_SUBMIT } from "./authStyles";

const DUPLICATE_EMAIL_MESSAGE = "Ten email jest już zarejestrowany, zaloguj się";

/** The "Załóż konto" tab of `/login` and of `AuthSheet`. A duplicate email
 * offers `onSwitchToLogin`, the host's login tab. */
export function RegisterForm({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const [role, setRole] = useState<RegisterPayload["role"]>("GUEST");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const id = useId();

  const isOrganizer = role === "ORGANIZER";
  const canSubmit = Boolean(role && email && password && !loading);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register({ role, email, password });
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
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
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
        <label htmlFor={`${id}-email`} className={AUTH_LABEL}>
          Email
        </label>
        <input
          id={`${id}-email`}
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
        <label htmlFor={`${id}-password`} className={AUTH_LABEL}>
          Hasło
        </label>
        <input
          id={`${id}-password`}
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
              <button type="button" onClick={onSwitchToLogin} className="font-semibold underline">
                Zaloguj się
              </button>
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
