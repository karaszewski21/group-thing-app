import { useState } from "react";
import type { Locality } from "../../api/locations";
import { ModalSheet } from "../../components/shared/ModalSheet";
import { RadiusChips } from "../../components/shared/RadiusChips";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const CARD = "flex h-full flex-col rounded-[22px] border border-line bg-paper p-4 md:rounded-4xl md:p-7";
const TITLE = "font-serif text-[20px] leading-tight font-extrabold text-ink md:text-[24px]";
const PRIMARY_BUTTON = `flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-[15px] font-extrabold text-on-primary ${FOCUS}`;
const OUTLINE_BUTTON = `flex min-h-11 items-center justify-center rounded-full border-[1.5px] border-line bg-paper px-5 text-[15px] font-extrabold text-ink hover:border-line-strong ${FOCUS}`;

/** Where the location panel stands: `checking` while the browser's
 * permission is read (a placeholder of the same size), `locating` while the
 * position or its locality loads, `ask`, `nearby`, `off` (with a way to turn
 * it on again) and `unavailable` (the browser blocks it or has none). */
export type LocationPanelState =
  | { kind: "checking" }
  | { kind: "locating" }
  | { kind: "ask" }
  | { kind: "nearby"; locality: Locality }
  | { kind: "off" }
  | { kind: "unavailable" };

function radiusLabel(radius: number | null): string {
  return radius === null ? "tylko tu" : `do ${radius} km`;
}

function PinMark({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 76 76" className={className}>
      <circle cx="38" cy="38" r="37" className="fill-primary-soft" />
      <circle cx="38" cy="44" r="20" fill="none" strokeWidth="2" className="stroke-primary/30" />
      <circle cx="38" cy="44" r="10" fill="none" strokeWidth="2" className="stroke-primary/50" />
      <path d="M38 16c-7 0-12 5.2-12 11.6C26 36 38 46 38 46s12-10 12-18.4C50 21.2 45 16 38 16z" className="fill-accent" />
      <circle cx="38" cy="27.5" r="4.5" className="fill-paper" />
    </svg>
  );
}

function SmallPin() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 flex-none">
      <path d="M12 2C8 2 5 5 5 8.8 5 14 12 22 12 22s7-8 7-13.2C19 5 16 2 12 2z" className="fill-accent" />
      <circle cx="12" cy="9" r="2.6" className="fill-paper" />
    </svg>
  );
}

function LockNote({ children }: { children: string }) {
  return (
    <p className="mt-2.5 flex items-center gap-1.5 text-xs text-ink-soft md:text-[13px]">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5 flex-none">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      {children}
    </p>
  );
}

/** The home feed's location card. On a phone the nearby state is a compact
 * bar that opens „Twoja okolica” (radius and turning off) in a sheet; from
 * `md` the card shows the radius chips itself. */
export function LocationPanel({
  state,
  radius,
  onRadiusChange,
  onTurnOn,
  onTurnOff,
}: {
  state: LocationPanelState;
  radius: number | null;
  onRadiusChange: (km: number | null) => void;
  onTurnOn: () => void;
  onTurnOff: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  switch (state.kind) {
    case "checking":
      return <div aria-hidden="true" className={`${CARD} min-h-24 md:min-h-72`} />;

    case "locating":
      return (
        <section className={`${CARD} flex-row items-center gap-3.5 md:flex-col md:items-start`}>
          <svg aria-hidden="true" viewBox="0 0 76 76" className="h-12 w-12 flex-none md:h-19 md:w-19">
            <circle cx="38" cy="38" r="37" className="fill-primary-soft" />
            <circle cx="38" cy="38" r="26" fill="none" strokeWidth="4" strokeDasharray="40 124" strokeLinecap="round" className="origin-center animate-spin stroke-primary motion-reduce:animate-none" />
            <circle cx="38" cy="38" r="6" className="fill-primary" />
          </svg>
          <div role="status" className="md:mt-4">
            <p className={TITLE}>Ustalamy Twoją okolicę…</p>
            <p className="mt-1 text-sm text-ink-soft md:mt-2 md:text-[15px]">Za chwilę pokażemy rzeczy i spotkania w pobliżu.</p>
          </div>
        </section>
      );

    case "ask":
      return (
        <section aria-labelledby="home-location" className={CARD}>
          <div className="flex items-center gap-3.5 md:flex-col md:items-start md:gap-4">
            <PinMark className="h-14 w-14 flex-none md:h-19 md:w-19" />
            <h2 id="home-location" className={TITLE}>
              Pokazać, co jest blisko Ciebie?
            </h2>
          </div>
          <p className="mt-2.5 text-sm leading-snug text-ink-soft md:text-[15px]">
            Włącz lokalizację, a pokażemy rzeczy i spotkania w Twojej okolicy.
          </p>
          <div className="mt-4 flex gap-2 md:mt-auto md:pt-5">
            <button type="button" onClick={onTurnOn} className={`${PRIMARY_BUTTON} flex-1 md:flex-none`}>
              Włącz lokalizację
            </button>
            <button type="button" onClick={onTurnOff} className={OUTLINE_BUTTON}>
              Nie teraz
            </button>
          </div>
          <LockNote>Nie zapisujemy Twojego położenia — tylko okolicę.</LockNote>
        </section>
      );

    case "nearby":
      return (
        <section aria-labelledby="home-location" className={`${CARD} p-2 md:p-7`}>
          <div className="flex items-center gap-2 md:items-start md:justify-between">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setSheetOpen(true)}
              className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-primary-soft px-3 text-left text-sm text-ink md:hidden ${FOCUS}`}
            >
              <SmallPin />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-extrabold">{state.locality.name}</b> · {radiusLabel(radius)}
              </span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-none text-primary-fg">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div className="hidden md:block">
              <h2 id="home-location" className="text-xs font-extrabold tracking-wide text-ink-soft uppercase">
                Twoja okolica
              </h2>
              <p className="mt-1 flex items-center gap-2 font-serif text-[30px] leading-tight font-extrabold text-ink">
                <SmallPin />
                {state.locality.name}
              </p>
            </div>
            <button
              type="button"
              onClick={onTurnOff}
              className={`flex h-11 w-11 flex-none items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-ink md:h-auto md:min-h-11 md:w-auto md:border-0 md:bg-transparent md:text-sm md:font-extrabold md:text-primary-fg md:underline ${FOCUS}`}
            >
              <span aria-hidden="true" className="text-lg leading-none md:hidden">
                ✕
              </span>
              <span className="sr-only md:not-sr-only">Wyłącz lokalizację</span>
            </button>
          </div>
          <div className="hidden md:mt-4 md:block">
            <p className="mb-2.5 text-[15px] text-ink-soft">Jak daleko szukać?</p>
            <RadiusChips value={radius} onChange={onRadiusChange} />
          </div>
          {sheetOpen && (
            <ModalSheet title="Twoja okolica" onClose={() => setSheetOpen(false)}>
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3 rounded-[18px] bg-primary-soft p-3.5">
                  <SmallPin />
                  <div>
                    <p className="text-lg font-extrabold text-ink">{state.locality.name}</p>
                    <p className="text-[13px] text-ink-soft">Ustalona z lokalizacji tego urządzenia</p>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-extrabold tracking-wide text-ink-soft uppercase">Jak daleko szukać</p>
                  <RadiusChips value={radius} onChange={onRadiusChange} />
                </div>
                <p className="text-[13px] leading-snug text-ink-soft">
                  Nie zapisujemy Twojego położenia. Wybór zostaje tylko w tej przeglądarce.
                </p>
                <button type="button" onClick={() => setSheetOpen(false)} className={`${PRIMARY_BUTTON} min-h-13`}>
                  Gotowe
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSheetOpen(false);
                    onTurnOff();
                  }}
                  className={`${OUTLINE_BUTTON} min-h-13 text-danger`}
                >
                  Wyłącz lokalizację
                </button>
                <p className="-mt-2 text-center text-xs text-ink-soft">Po wyłączeniu pokażemy najnowsze ze wszystkich okolic.</p>
              </div>
            </ModalSheet>
          )}
        </section>
      );

    case "off":
      return (
        <section className={`${CARD} flex-row items-center justify-between gap-2.5 bg-stage p-3 md:flex-col md:items-start md:justify-start md:bg-paper md:p-7`}>
          <div>
            <p className="text-[13px] text-ink md:font-serif md:text-[24px] md:leading-tight md:font-extrabold">
              Pokazujemy najnowsze ze wszystkich okolic.
            </p>
            <p className="mt-2 hidden text-[15px] text-ink-soft md:block">Włącz lokalizację, żeby zobaczyć, co jest blisko.</p>
          </div>
          <button
            type="button"
            onClick={onTurnOn}
            className={`flex min-h-11 flex-none items-center rounded-full border-[1.5px] border-primary bg-primary-soft px-4 text-[13px] font-extrabold text-primary-fg md:mt-auto md:px-5 md:text-[15px] ${FOCUS}`}
          >
            Pokaż w pobliżu
          </button>
        </section>
      );

    case "unavailable":
      return (
        <section className={`${CARD} bg-stage md:bg-paper`}>
          <p className="text-[13px] text-ink md:font-serif md:text-[24px] md:leading-tight md:font-extrabold">
            Pokazujemy najnowsze ze wszystkich okolic.
          </p>
          <p className="mt-1 text-[13px] text-ink-soft md:mt-2 md:text-[15px]">
            Ta przeglądarka nie udostępnia lokalizacji.
          </p>
        </section>
      );
  }
}
