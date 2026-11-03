"use client";

import "./globals.css";

/** Replaces the root layout when it fails, so it renders its own document. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pl">
      <body>
        <main className="mx-auto max-w-md px-5 pt-16 text-center">
          <h1 className="text-[22px] font-bold text-ink">Coś poszło nie tak</h1>
          <p className="mt-2 text-[13.5px] text-ink-soft">Nie udało się wczytać aplikacji. Spróbuj ponownie za chwilę.</p>
          <button type="button" onClick={reset} className="mt-6 font-semibold text-primary-fg underline">
            Spróbuj ponownie
          </button>
        </main>
      </body>
    </html>
  );
}
