import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { AuthGuard } from "../../auth/AuthGuard";
import { AUTH_TAB_PARAM, REGISTER_TAB_VALUE, type AuthTab } from "../../auth/authPaths";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { SocialAuthButtons } from "../../components/layout/SocialAuthButtons";
import { AUTH_INPUT, AUTH_LABEL, AUTH_SUBMIT } from "../../components/layout/authStyles";
import { RegisterForm } from "./RegisterForm";

const TABS: { key: AuthTab; label: string; title: string; subtitle: string }[] = [
  {
    key: "login",
    label: "Zaloguj się",
    title: "Witaj w kręgu",
    subtitle: "Zaloguj się, żeby zobaczyć swoje rzeczy i spotkania.",
  },
  { key: "register", label: "Załóż konto", title: "Dołącz do kręgu", subtitle: "Załóż konto — zajmie to minutę." },
];

const TAB_CLASS =
  "min-h-11 flex-1 rounded-full px-3 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** `/login`: logging in and registering on one page, as two tabs. The tab
 * lives in `?mode=register` so links (and a refresh) can open "Załóż
 * konto" directly; `?returnTo=` survives switching tabs. A logged-in visitor
 * is sent on by AuthGuard — after registering to onboarding first. */
export function LoginPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: AuthTab = searchParams.get(AUTH_TAB_PARAM) === REGISTER_TAB_VALUE ? "register" : "login";
  const current = TABS.find((t) => t.key === tab)!;
  const baseId = useId();
  const tabRefs = useRef<Record<AuthTab, HTMLButtonElement | null>>({ login: null, register: null });

  function selectTab(next: AuthTab) {
    setSearchParams(
      (params) => {
        if (next === "register") params.set(AUTH_TAB_PARAM, REGISTER_TAB_VALUE);
        else params.delete(AUTH_TAB_PARAM);
        return params;
      },
      { replace: true },
    );
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: AuthTab = tab === "login" ? "register" : "login";
    selectTab(next);
    tabRefs.current[next]?.focus();
  }

  const guardProps = tab === "register" ? { authenticatedRedirect: "/onboarding", forwardReturnTo: true } : {};

  return (
    <AuthGuard requireAuth={false} {...guardProps}>
      <AuthLayout title={current.title} subtitle={current.subtitle}>
        <div role="tablist" aria-label="Konto" className="relative mb-4 flex gap-1 rounded-full bg-line p-1">
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[t.key] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-${t.key}-tab`}
                aria-selected={on}
                aria-controls={`${baseId}-panel`}
                tabIndex={on ? 0 : -1}
                onClick={() => selectTab(t.key)}
                onKeyDown={onTabKeyDown}
                className={`${TAB_CLASS} ${on
                    ? "bg-paper font-extrabold text-ink shadow-[0_2px_8px_-2px_rgba(42,35,32,0.25)]"
                    : "font-extrabold text-ink-soft hover:text-ink"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-${tab}-tab`}>
          <SocialAuthButtons />
          {tab === "login" ? <LoginForm /> : <RegisterForm />}
        </div>
      </AuthLayout>
    </AuthGuard>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // The page's AuthGuard sees the new token and sends the user on: to
      // `returnTo`, or to their role's home (`homePath`).
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zalogować");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
  );
}
