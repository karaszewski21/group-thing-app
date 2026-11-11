import { useId, useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import { AUTH_INPUT, AUTH_LABEL, AUTH_SUBMIT } from "./authStyles";

const DUPLICATE_EMAIL_MESSAGE = "Ten email jest już zarejestrowany, zaloguj się";

/** The "Załóż konto" tab of `/login` and of `AuthSheet`: email and password
 * only, every new account starts as a guest. A duplicate email offers
 * `onSwitchToLogin`, the host's login tab. */
export function RegisterForm({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const id = useId();

  const canSubmit = Boolean(email && password && !loading);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register({ email, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zarejestrować");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
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
