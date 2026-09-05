import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      const returnTo = searchParams.get("returnTo") || "/panel";
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zalogować");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 font-sans text-ink">
      <div className="w-full max-w-[400px] rounded-[22px] border border-line bg-paper p-10">
        <h1 className="mb-2 text-center font-serif text-2xl font-semibold text-ink">
          Krąg <span className="text-mint">grupy</span>
        </h1>
        <p className="mb-8 text-center text-sm text-ink-soft">Zaloguj się do swojego konta</p>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-ink">
              Nazwa użytkownika
            </label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Wpisz nazwę użytkownika"
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-mint"
            />
          </div>

          <div className="mb-6">
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">
              Hasło
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Wpisz hasło"
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-mint"
            />
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full rounded-full bg-mint px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-60"
          >
            {loading ? "Logowanie…" : "Zaloguj się"}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] text-ink-soft">
          Nie masz konta?{" "}
          <Link to="/register" className="font-semibold text-mint">
            Zarejestruj się
          </Link>
        </p>
      </div>
    </div>
  );
}
