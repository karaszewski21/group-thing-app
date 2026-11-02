const CTA =
  "min-h-14 w-full rounded-full px-5 text-[17px] font-extrabold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const CTA_PRIMARY = `${CTA} border-0 bg-primary text-on-primary`;
const CTA_OUTLINE = `${CTA} border-[1.5px] border-line-strong bg-transparent text-ink`;

export type EventFooterProps =
  | { variant: "signUp"; busy: boolean; onSignUp: () => void }
  | { variant: "withdraw"; busy: boolean; onWithdraw: () => void }
  | { variant: "ended" };

/** Sticky footer of the event page, an event-only copy of `TermFooter`:
 * sign up, withdraw, or a disabled notice once the event has ended. The
 * caller picks the variant (or renders nothing for the author). */
export function EventFooter(props: EventFooterProps) {
  return (
    <footer className="sticky bottom-0 z-20 mt-6 border-t border-line bg-cream px-5 pt-3.5 pb-5">
      {props.variant === "signUp" && (
        <button type="button" className={CTA_PRIMARY} disabled={props.busy} onClick={props.onSignUp}>
          ＋ Zapisz się na wydarzenie
        </button>
      )}
      {props.variant === "withdraw" && (
        <button type="button" className={CTA_OUTLINE} disabled={props.busy} onClick={props.onWithdraw}>
          Wypisz się
        </button>
      )}
      {props.variant === "ended" && (
        <button type="button" className={CTA_PRIMARY} disabled>
          Wydarzenie się zakończyło
        </button>
      )}
    </footer>
  );
}
