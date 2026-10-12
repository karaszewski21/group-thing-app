import type { ReactNode } from "react";

/** Seats on the hero's dashed ring, clockwise from the top; one stays empty
 * (dashed) to read as "a place for you". */
const SEATS = [
  { tone: "bg-accent" },
  { tone: "bg-accent-soft" },
  { tone: "bg-primary-soft" },
  { tone: "bg-on-primary/90" },
  { tone: "bg-accent" },
  { tone: "border-2 border-dashed border-on-primary/60" },
];
const RING_RADIUS = 38; // % of the ring box

/** Login / register shell: a primary hero with the Krąg grupy mark sitting in
 * a circle of families, and the form on a sheet that overlaps it. Full screen
 * on a phone, a centered card on wider screens. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen justify-center bg-cream font-sans text-ink min-[520px]:items-center min-[520px]:bg-stage min-[520px]:px-4 min-[520px]:py-10">
      <div className="w-full max-w-[440px] overflow-hidden bg-cream min-[520px]:rounded-[28px] min-[520px]:border min-[520px]:border-line min-[520px]:shadow-[0_30px_60px_-30px_rgba(30,46,39,0.28)]">
        <div aria-hidden="true" className="relative h-64 overflow-hidden bg-primary">
          <div className="absolute top-1/2 left-1/2 h-56 w-56 -translate-x-1/2 -translate-y-[54%]">
            <span className="absolute inset-[12%] rounded-full border-2 border-dashed border-on-primary/35" />
            {SEATS.map((seat, index) => {
              const angle = (index / SEATS.length) * 2 * Math.PI - Math.PI / 2;
              return (
                <span
                  key={index}
                  className={`absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full ${seat.tone}`}
                  style={{
                    left: `${50 + RING_RADIUS * Math.cos(angle)}%`,
                    top: `${50 + RING_RADIUS * Math.sin(angle)}%`,
                  }}
                />
              );
            })}
            <span className="absolute top-1/2 left-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[26px] bg-paper font-serif text-[32px] font-extrabold text-primary-fg">
              KG
            </span>
          </div>
        </div>
        <div className="relative -mt-7 rounded-t-[28px] bg-cream px-6 pt-7 pb-8">
          <p className="text-xs font-extrabold tracking-[.14em] text-primary-fg uppercase">Krąg grupy</p>
          <h1 className="mt-1 font-serif text-[32px] leading-tight font-extrabold tracking-tight text-ink">{title}</h1>
          <p className="mt-1 mb-6 text-base text-ink-soft">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
