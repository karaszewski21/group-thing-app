import type { ReactNode } from "react";

/** Login / register shell: a compact sheet that fits between PublicLayout's
 * top bar and bottom tab bar on a phone (so neither covers the form), with a
 * small dashed "circle of families" in the corner; a centered card on wider
 * screens. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 justify-center font-sans text-ink min-[520px]:items-center min-[520px]:bg-stage min-[520px]:px-4 min-[520px]:py-10">
      <div className="relative w-full max-w-110 overflow-hidden bg-cream px-5 pt-5 pb-8 min-[520px]:rounded-[28px] min-[520px]:border min-[520px]:border-line min-[520px]:px-7 min-[520px]:pt-7 min-[520px]:shadow-[0_30px_60px_-30px_rgba(30,46,39,0.28)]">
        <div aria-hidden="true" className="pointer-events-none absolute -top-10 -right-11 h-37.5 w-37.5">
          <span className="absolute inset-0 rounded-full border-2 border-dashed border-primary-soft" />
          <span className="absolute top-12 left-6 h-5.5 w-5.5 rounded-full bg-accent" />
          <span className="absolute top-25 left-15 h-5.5 w-5.5 rounded-full bg-teal" />
          <span className="absolute top-28 left-27 h-5.5 w-5.5 rounded-full bg-primary-soft" />
        </div>
        <h1 className="relative max-w-[80%] font-serif text-[30px] leading-tight font-extrabold tracking-tight text-ink">
          {title}
        </h1>
        <p className="relative mt-0.5 mb-4 max-w-[80%] text-[15px] text-ink-soft">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
