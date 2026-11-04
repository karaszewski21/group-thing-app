import { useId, useRef, type KeyboardEvent } from "react";
import type { AuthTab } from "../../auth/authPaths";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import { SocialAuthButtons } from "./SocialAuthButtons";

const TAB_LABELS: Record<AuthTab, string> = { login: "Zaloguj się", register: "Załóż konto" };
const TAB_ORDER: AuthTab[] = ["login", "register"];

const TAB_CLASS =
  "min-h-11 flex-1 rounded-full px-3 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** "Zaloguj się" / "Załóż konto" as two tabs over the matching form — the one
 * login/register UI, shared by `/login` (tab in the URL) and `AuthSheet`
 * (tab in state). Arrow keys switch tabs. */
export function AuthTabs({ tab, onSelect }: { tab: AuthTab; onSelect: (tab: AuthTab) => void }) {
  const baseId = useId();
  const tabRefs = useRef<Record<AuthTab, HTMLButtonElement | null>>({ login: null, register: null });

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: AuthTab = tab === "login" ? "register" : "login";
    onSelect(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <div role="tablist" aria-label="Konto" className="relative mb-4 flex gap-1 rounded-full bg-line p-1">
        {TAB_ORDER.map((key) => {
          const on = key === tab;
          return (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-${key}-tab`}
              aria-selected={on}
              aria-controls={`${baseId}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => onSelect(key)}
              onKeyDown={onTabKeyDown}
              className={`${TAB_CLASS} ${
                on
                  ? "bg-paper font-extrabold text-ink shadow-[0_2px_8px_-2px_rgba(42,35,32,0.25)]"
                  : "font-extrabold text-ink-soft hover:text-ink"
              }`}
            >
              {TAB_LABELS[key]}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-${tab}-tab`}>
        <SocialAuthButtons />
        {tab === "login" ? <LoginForm /> : <RegisterForm onSwitchToLogin={() => onSelect("login")} />}
      </div>
    </>
  );
}
