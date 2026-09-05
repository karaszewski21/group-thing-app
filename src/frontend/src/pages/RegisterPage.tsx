import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, type RegisterPayload } from "../auth/AuthContext";

const inputClass =
  "w-full rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-sm text-ink outline-none focus:border-mint focus:ring-[3px] focus:ring-mint-soft";
const labelClass = "mb-1.5 block text-xs font-extrabold tracking-wide text-ink-soft";

export function RegisterPage() {
  const [role, setRole] = useState<RegisterPayload["role"]>("GUEST");
  const [familyName, setFamilyName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [circleName, setCircleName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const isOrganizer = role === "ORGANIZER";
  const canSubmit =
    familyName && username && password && displayName && (!isOrganizer || circleName) && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register({
        role,
        familyName,
        username,
        password,
        displayName,
        email: email || undefined,
        circleName: isOrganizer ? circleName : undefined,
      });
      navigate("/panel", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zarejestrować");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-10 font-sans text-ink">
      <div className="w-full max-w-[440px] rounded-[22px] border border-line bg-paper p-10">
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
                className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition ${
                  role === "GUEST"
                    ? "border-mint bg-mint-soft text-mint"
                    : "border-line bg-cream text-ink-soft"
                }`}
              >
                Gość
              </button>
              <button
                type="button"
                onClick={() => setRole("ORGANIZER")}
                className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition ${
                  role === "ORGANIZER"
                    ? "border-mint bg-mint-soft text-mint"
                    : "border-line bg-cream text-ink-soft"
                }`}
              >
                Organizator
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink-soft">
              {isOrganizer
                ? "Od razu założysz własną grupę zajęciową."
                : "Dołączysz jako rodzina — własną grupę możesz założyć później z panelu."}
            </p>
          </div>

          <div className="mb-4">
            <label htmlFor="family-name" className={labelClass}>
              Nazwa rodziny
            </label>
            <input
              id="family-name"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder="np. Rodzina Kowalskich"
              className={inputClass}
            />
          </div>

          {isOrganizer && (
            <div className="mb-4">
              <label htmlFor="circle-name" className={labelClass}>
                Nazwa grupy
              </label>
              <input
                id="circle-name"
                value={circleName}
                onChange={(e) => setCircleName(e.target.value)}
                placeholder="np. Muzyczne Maluchy"
                className={inputClass}
              />
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="display-name" className={labelClass}>
              Twoje imię i nazwisko
            </label>
            <input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="np. Anna Kowalska"
              className={inputClass}
            />
          </div>

          <div className="mb-4">
            <label htmlFor="email" className={labelClass}>
              Email (opcjonalnie)
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ty@przyklad.pl"
              className={inputClass}
            />
          </div>

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
            disabled={!canSubmit}
            className="w-full rounded-[13px] bg-mint px-4 py-3 text-[13.5px] font-extrabold text-white shadow-[0_8px_18px_-10px_rgba(27,129,104,0.85)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {loading ? "Zakładanie konta…" : "Załóż konto"}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] text-ink-soft">
          Masz już konto?{" "}
          <Link to="/login" className="font-semibold text-mint">
            Zaloguj się
          </Link>
        </p>
      </div>
    </div>
  );
}
