import { useState } from "react";

type Provider = "Google" | "Facebook";

const BUTTON_CLASS =
  "flex min-h-12 items-center justify-center gap-2 rounded-full border-[1.5px] border-line bg-paper text-[15px] font-bold text-ink transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path
        fill="#FFFFFF"
        d="M13.4 19.5v-6.1h2.1l.3-2.4h-2.4V9.5c0-.7.2-1.2 1.2-1.2h1.3V6.2c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3V11H8.7v2.4h2.1v6.1h2.6z"
      />
    </svg>
  );
}

/** "Kontynuuj przez Google / Facebook" above the email form, then an
 * "lub emailem" divider. MOCK: the backend has no social login yet, so a
 * click only says it is coming. */
export function SocialAuthButtons() {
  const [pending, setPending] = useState<Provider | null>(null);

  return (
    <div className="mb-4">
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" onClick={() => setPending("Google")} aria-label="Kontynuuj przez Google" className={BUTTON_CLASS}>
          <GoogleMark />
          Google
        </button>
        <button type="button" onClick={() => setPending("Facebook")} aria-label="Kontynuuj przez Facebook" className={BUTTON_CLASS}>
          <FacebookMark />
          Facebook
        </button>
      </div>
      <p role="status" className="mt-2 min-h-4.5 text-center text-xs text-ink-soft">
        {pending && `Logowanie przez ${pending} będzie dostępne wkrótce.`}
      </p>
      <div className="mt-1 flex items-center gap-2.5 text-[13px] font-bold text-ink-soft">
        <span className="h-px flex-1 bg-line" />
        lub emailem
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
