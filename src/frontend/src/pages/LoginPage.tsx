import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthLayout } from "../components/layout/AuthLayout";
import { AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AUTH_SUBMIT } from "../components/layout/authStyles";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate(returnTo || "/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zalogować");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Witaj w kręgu" subtitle="Zaloguj się do swojego konta">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="email" className={AUTH_LABEL}>
            Email
          </label>
          <input
            id="email"
            type="email"
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Wpisz hasło"
            className={AUTH_INPUT}
          />
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

      <p className="mt-6 text-center text-[15px] text-ink-soft">
        Nie masz konta?{" "}
        <Link to={returnTo ? `/register?returnTo=${encodeURIComponent(returnTo)}` : "/register"} className={AUTH_LINK}>
          Zarejestruj się
        </Link>
      </p>
    </AuthLayout>
  );
}
