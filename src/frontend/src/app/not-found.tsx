import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-5 pt-16 text-center">
      <h1 className="text-[22px] font-bold text-ink">Nie znaleziono strony</h1>
      <p className="mt-2 text-[13.5px] text-ink-soft">Ten adres nie istnieje albo strona została usunięta.</p>
      <Link href="/" className="mt-6 inline-block font-semibold text-primary-fg underline">
        Wróć na stronę główną
      </Link>
    </main>
  );
}
