import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useRegisterOpenSheet } from "./openSheets";
import dayjs from "../../utils/dayjs";
import { CAPACITY_ERROR, capitalize, ITEM_MODE_TONE, parseCapacity, type ItemMode } from "../../utils/appHelpers";
import { BackIcon, ChevronRightIcon, CloseIcon } from "./appIcons";
import type { MockMeeting } from "../../utils/mocks";

/* ---------------- małe komponenty pomocnicze (wydzielone z AppPage.tsx) ---------------- */

/** Scroll distance after which the floating add button shows its label. */
const FAB_EXPAND_SCROLL = 100;

const FAB_CLASS =
  "pointer-events-auto flex h-14 min-w-14 items-center justify-center rounded-full bg-primary text-base font-extrabold text-on-primary shadow-[0_12px_24px_-12px_var(--color-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-safe:transition-[padding] motion-safe:duration-200";

/** The round "+" floating just above the bottom tab bar. At the top of the
 * page it is the "+" alone; once the page is scrolled it widens to show its
 * label. The label stays in the DOM while collapsed, so the accessible name
 * ("+ Dodaj termin") never changes. Renders its own spacer, so at the end of
 * a list it never covers the last row. */
export function FloatingAddButton({
  label,
  to,
  onClick,
}: {
  label: string;
  to?: string;
  onClick?: () => void;
}) {
  const [expanded, setExpanded] = useState(() => window.scrollY > FAB_EXPAND_SCROLL);

  useEffect(() => {
    const update = () => setExpanded(window.scrollY > FAB_EXPAND_SCROLL);
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const content = (
    <>
      <span className="text-[24px] leading-none">
        +
      </span>{" "}
      <span
        className={`overflow-hidden whitespace-nowrap motion-safe:transition-all motion-safe:duration-200 ${
          expanded ? "ml-1.5 max-w-48 opacity-100" : "max-w-0 opacity-0"
        }`}
      >
        {label}
      </span>
    </>
  );
  const className = `${FAB_CLASS} ${expanded ? "px-5.5" : "px-0"}`;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-[86px] z-30 mx-auto flex max-w-[1200px] justify-end px-4">
        {to ? (
          <Link to={to} className={className}>
            {content}
          </Link>
        ) : (
          <button type="button" onClick={onClick} className={className}>
            {content}
          </button>
        )}
      </div>
      <div aria-hidden="true" className="h-20" />
    </>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line py-3.5 first:border-t-0">
      <div>
        <strong className="block text-sm text-ink">{label}</strong>
        <small className="mt-0.5 block text-xs text-ink-soft">{hint}</small>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={`relative h-[26px] w-11 flex-none rounded-full transition-colors ${checked ? "bg-mint" : "bg-line"}`}
      >
        <span
          className="absolute top-[3px] left-[3px] h-5 w-5 rounded-full bg-white shadow transition-transform"
          style={checked ? { transform: "translateX(18px)" } : undefined}
        />
      </button>
    </div>
  );
}

/** Dismissible Panel-home nudge card (spec.md §3, Mockups 4/5). Same card
 * shell/spacing rhythm as "Najbliższe terminy"/"Twoje rzeczy", with a mint
 * accent to read as actionable/new. CTA is either a `Link` (org-polish, to
 * "/organization") or a plain button (both first-term variants, opens the
 * "pierwszy-termin" modal) — never both, so exactly one of `ctaTo`/
 * `onCtaClick` is expected per instance. */
export function HintCard({
  icon,
  title,
  description,
  ctaLabel,
  ctaTo,
  onCtaClick,
  onDismiss,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  ctaLabel: string;
  ctaTo?: string;
  onCtaClick?: () => void;
  onDismiss: () => void;
}) {
  const cta = "mt-2 inline-block text-sm font-extrabold text-accent-fg hover:underline";
  return (
    <div className="mb-3.5 flex gap-3.5 rounded-3xl bg-accent-soft p-4.5">
      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-accent text-ink">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="pt-0.5 text-base font-extrabold text-ink">{title}</h3>
          <button
            onClick={onDismiss}
            aria-label={`Zamknij: ${title}`}
            className="-mt-1 -mr-1 flex h-9 w-9 flex-none items-center justify-center rounded-full text-ink-soft hover:bg-paper/60 hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>
        <p className="mt-0.5 text-sm text-ink">{description}</p>
        {ctaTo ? (
          <Link to={ctaTo} className={cta}>
            {ctaLabel}
          </Link>
        ) : (
          <button onClick={onCtaClick} className={cta}>
            {ctaLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-extrabold tracking-wide text-ink-soft">{label}</label>
      {children}
    </div>
  );
}

export const INPUT_CLASS = "rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink";

/** The "Ile miejsc" field: `value` is the raw input text (see `parseCapacity`);
 * an invalid value shows an inline error, and the host blocks submit. A text
 * input, not `type="number"`: that one reports `""` for input like "-" or "e",
 * which would silently save as "no limit". */
export function CapacityField({
  label,
  value,
  onChange,
  inputClassName = `${INPUT_CLASS} w-28`,
}: {
  label: string;
  value: string;
  onChange: (raw: string) => void;
  inputClassName?: string;
}) {
  const errorId = useId();
  const invalid = parseCapacity(value) === undefined;
  return (
    <Field label={label}>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="np. 12"
        className={inputClassName}
      />
      {invalid && (
        <p id={errorId} role="alert" className="text-[12.5px] font-semibold text-danger">
          {CAPACITY_ERROR}
        </p>
      )}
    </Field>
  );
}

const SHEET_FIRST_FIELD =
  "input:not([type='hidden']):not(:disabled), select:not(:disabled), textarea:not(:disabled)";

export function ModalSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement);
  useRegisterOpenSheet(true);

  // On open, focus the first form field unless a child (autoFocus, its own effect) already took focus.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      (dialog.querySelector<HTMLElement>(SHEET_FIRST_FIELD) ?? dialog).focus();
    }
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
        opener.focus();
      } else {
        document.querySelector<HTMLElement>("main")?.focus();
      }
    };
  }, [opener]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(20,28,24,0.55)] min-[520px]:items-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full max-w-[430px] overflow-y-auto rounded-t-[24px] bg-paper p-5 outline-none min-[520px]:max-h-[80vh] min-[520px]:rounded-[24px]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-cream text-ink-soft hover:bg-danger-soft hover:text-danger"
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A square photo tile of someone else's item (Start's "Ostatnio dodane",
 * the search results): mode chip, name and owner. */
export function ItemTile({ name, owner, mode, note }: { name: string; owner: string; mode: ItemMode; note?: string }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-[22px] border border-line bg-paper">
      <div className={`relative aspect-square ${ITEM_MODE_TONE[mode]}`}>
        <span className="absolute top-2 left-2 rounded-full bg-paper px-2.5 py-1 text-[11px] font-extrabold text-ink">
          {capitalize(mode)}
        </span>
        {note && (
          <span className="absolute top-2 right-2 rounded-full bg-ink/75 px-2 py-1 text-[11px] font-bold text-on-ink">
            {note}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 px-3 pt-2.5 pb-3">
        <h4 className="text-[15px] leading-tight font-bold text-ink">{name}</h4>
        <p className="text-xs text-ink-soft">{owner}</p>
      </div>
    </article>
  );
}

export interface ListRowItem {
  label: string;
  meta?: string;
  to?: string;
  onClick?: () => void;
}

/** A white card of tappable rows (label · meta · chevron), as in Konto. */
export function ListCard({ rows }: { rows: ListRowItem[] }) {
  const rowClass =
    "flex min-h-13 w-full items-center gap-3 px-4 py-3.5 text-left text-ink transition-colors hover:bg-cream focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring";
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-paper">
      {rows.map((row) => {
        const content = (
          <>
            <span className="min-w-0 flex-1 text-base font-semibold">{row.label}</span>
            {row.meta && <span className="text-sm text-ink-soft">{row.meta}</span>}
            <span className="text-ink-soft">
              <ChevronRightIcon />
            </span>
          </>
        );
        return (
          <li key={row.label}>
            {row.to ? (
              <Link to={row.to} className={rowClass}>
                {content}
              </Link>
            ) : (
              <button type="button" onClick={row.onClick} className={rowClass}>
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Back link + title for panel sub-pages without the tab bar; `action`
 * (e.g. a link to a related page) sits at the right end. */
export function SubPageHeader({
  title,
  backTo,
  backLabel,
  action,
}: {
  title?: string;
  backTo: string;
  backLabel: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <Link
        to={backTo}
        aria-label={backLabel}
        className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-[1.5px] border-line bg-paper hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <BackIcon />
      </Link>
      {title && (
        <h1 className="font-serif text-[26px] leading-tight font-extrabold tracking-tight text-ink">{title}</h1>
      )}
      {action && <div className="ml-auto flex-none">{action}</div>}
    </div>
  );
}

/** One meeting card: weekday/day badge, group · time, organizer and spots. */
export function MeetingRow({ meeting }: { meeting: MockMeeting }) {
  const at = dayjs(meeting.occursOn);
  return (
    <div className="flex items-center gap-3 rounded-[22px] border border-line bg-paper p-3.5">
      <div className="flex h-14.5 w-13 flex-none flex-col items-center justify-center rounded-2xl bg-accent-soft leading-none">
        <small className="text-[10px] font-extrabold tracking-wide text-accent-fg uppercase">{at.format("dd")}</small>
        <b className="mt-0.5 font-serif text-[22px] font-extrabold text-ink">{at.format("D")}</b>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-bold text-ink">
          {meeting.group} · {at.format("H:mm")}
        </h3>
        <p className="text-sm text-ink-soft">{meeting.organizer}</p>
        <p className="text-[13px] font-bold text-primary-fg">{meeting.spots}</p>
      </div>
    </div>
  );
}
