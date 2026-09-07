import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const inputClass =
  "w-full rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-sm text-ink outline-none focus:border-mint focus:ring-[3px] focus:ring-mint-soft";
const labelClass = "mb-1.5 block text-xs font-extrabold tracking-wide text-ink-soft";

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream px-4 font-sans text-ink">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-mint-soft/70 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -right-16 h-80 w-80 rounded-full bg-lime-soft/60 blur-3xl" />

      <div className="relative w-full max-w-[400px] rounded-[22px] border border-line bg-paper p-10 shadow-[0_30px_60px_-30px_rgba(30,46,39,0.28)]">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border-2 border-mint-soft bg-mint-soft font-serif text-xl font-semibold text-mint">
          KG
        </div>
        <h1 className="mb-2 text-center font-serif text-2xl font-semibold text-ink">
          Krąg <span className="text-mint">grupy</span>
        </h1>
        <p className="mb-8 text-center text-sm text-ink-soft">Zaloguj się do swojego konta</p>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="username" className={labelClass}>
              Nazwa użytkownika
            </label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Wpisz nazwę użytkownika"
              className={inputClass}
            />
          </div>

          <div className="mb-6">
            <label htmlFor="password" className={labelClass}>
              Hasło
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Wpisz hasło"
              className={inputClass}
            />
          </div>

          {error && (
            <div className="mb-4 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full rounded-[13px] bg-mint px-4 py-3 text-[13.5px] font-extrabold text-white shadow-[0_8px_18px_-10px_rgba(27,129,104,0.85)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {loading ? "Logowanie…" : "Zaloguj się"}
          </button>
        </form>

        <div className="mx-auto mt-7 h-px w-full bg-line" />

        <p className="mt-5 text-center text-[13px] text-ink-soft">
          Nie masz konta?{" "}
          <Link to="/register" className="font-semibold text-mint hover:underline">
            Zarejestruj się
          </Link>
        </p>
      </div>
    </div>
  );
}
