import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, type RegisterPayload } from "../auth/AuthContext";

const inputClass =
  "w-full rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-sm text-ink outline-none focus:border-mint focus:ring-[3px] focus:ring-mint-soft";
const labelClass = "mb-1.5 block text-xs font-extrabold tracking-wide text-ink-soft";

const DUPLICATE_EMAIL_MESSAGE = "Ten email jest już zarejestrowany, zaloguj się";

export function RegisterPage() {
  const [role, setRole] = useState<RegisterPayload["role"]>("GUEST");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const isOrganizer = role === "ORGANIZER";
  const canSubmit = Boolean(role && email && password && !loading);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register({ role, email, password });
      navigate("/onboarding", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zarejestrować");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream px-4 py-10 font-sans text-ink">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-mint-soft/70 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -right-16 h-80 w-80 rounded-full bg-lime-soft/60 blur-3xl" />

      <div className="relative w-full max-w-[440px] rounded-[22px] border border-line bg-paper p-10 shadow-[0_30px_60px_-30px_rgba(30,46,39,0.28)]">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border-2 border-mint-soft bg-mint-soft font-serif text-xl font-semibold text-mint">
          KG
        </div>
        <h1 className="mb-2 text-center font-serif text-2xl font-semibold text-ink">
          Krąg <span className="text-mint">grupy</span>
        </h1>
        <p className="mb-8 text-center text-sm text-ink-soft">Załóż nowe konto</p>

        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <span className={labelClass}>Kim jesteś?</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRole("GUEST")}
                className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition-all ${
                  role === "GUEST"
                    ? "border-mint bg-mint-soft text-mint shadow-[0_6px_14px_-8px_rgba(27,129,104,0.6)]"
                    : "border-line bg-cream text-ink-soft hover:border-sage"
                }`}
              >
                Gość
              </button>
              <button
                type="button"
                onClick={() => setRole("ORGANIZER")}
                className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition-all ${
                  role === "ORGANIZER"
                    ? "border-mint bg-mint-soft text-mint shadow-[0_6px_14px_-8px_rgba(27,129,104,0.6)]"
                    : "border-line bg-cream text-ink-soft hover:border-sage"
                }`}
              >
                Organizator
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink-soft text-center">
              {isOrganizer
                ? "Zorganizuj się po swojemu – twórz grupy i planuj terminy w kilka chwil."
                : "Dołączysz jako rodzina — własną grupę możesz założyć później z panelu."}
            </p>
          </div>

          <div className="mb-4">
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ty@przyklad.pl"
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
              {error === DUPLICATE_EMAIL_MESSAGE && (
                <>
                  {" "}
                  <Link to="/login" className="font-semibold underline">
                    Zaloguj się
                  </Link>
                </>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-[13px] bg-mint px-4 py-3 text-[13.5px] font-extrabold text-white shadow-[0_8px_18px_-10px_rgba(27,129,104,0.85)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {loading ? "Zakładanie konta…" : "Załóż konto"}
          </button>
        </form>

        <div className="mx-auto mt-7 h-px w-full bg-line" />

        <p className="mt-5 text-center text-[13px] text-ink-soft">
          Masz już konto?{" "}
          <Link to="/login" className="font-semibold text-mint hover:underline">
            Zaloguj się
          </Link>
        </p>
      </div>
    </div>
  );
}
