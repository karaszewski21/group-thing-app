import { useId, useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Link } from "../../routing/navigation";
import { AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AUTH_SUBMIT } from "./authStyles";

/** Email + password login. On success the session token changes in place;
 * the host (`/login`'s AuthGuard, or the page under `AuthSheet`) reacts.
 * `onNavigateAway` runs when a link leaves the form's page (the sheet closes). */
export function LoginForm({ onNavigateAway }: { onNavigateAway?: () => void } = {}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const id = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zalogować");
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Wpisz hasło"
          className={AUTH_INPUT}
        />
        <p className="mt-2 text-right text-sm">
          <Link to="/reset-password" className={AUTH_LINK} onClick={onNavigateAway}>
            Nie pamiętasz hasła?
          </Link>
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}

      <button type="submit" disabled={loading || !email || !password} className={`mt-1 ${AUTH_SUBMIT}`}>
        {loading ? "Logowanie…" : "Zaloguj się"}
      </button>
    </form>
  );
}
