"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-5 pt-16 text-center">
      <h1 className="text-[22px] font-bold text-ink">Coś poszło nie tak</h1>
      <p className="mt-2 text-[13.5px] text-ink-soft">Nie udało się wyświetlić tej strony. Spróbuj ponownie za chwilę.</p>
      <button type="button" onClick={reset} className="mt-6 font-semibold text-primary-fg underline">
        Spróbuj ponownie
      </button>
    </main>
  );
}
