import type { ReactNode } from "react";

/** A family sub-page: its title and body. */
export function FamilySubPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      {children}
    </section>
  );
}

export function FamilyNotice({ children }: { children: ReactNode }) {
  return <p className="rounded-[22px] border border-line bg-paper p-5 text-sm text-ink-soft">{children}</p>;
}

export function SubmitButton({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
      {message}
    </p>
  );
}
