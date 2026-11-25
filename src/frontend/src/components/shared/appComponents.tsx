import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "../../routing/navigation";
import { useRegisterOpenSheet } from "./openSheets";
import {
  CAPACITY_ERROR,
  MAX_PAYMENT_URL_LENGTH,
  parseCapacity,
  parsePaymentUrl,
  parsePrice,
  PAYMENT_URL_ERROR,
  PAYMENT_URL_LENGTH_ERROR,
  PAYMENT_URL_REQUIRES_PRICE_ERROR,
  PRICE_ERROR,
} from "../../utils/appHelpers";
import { ChevronRightIcon, CloseIcon } from "./appIcons";

/* ---------------- małe komponenty pomocnicze (wydzielone z AppPage.tsx) ---------------- */

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
      <Switch checked={checked} label={label} onChange={onChange} />
    </div>
  );
}

/** An on/off switch button; `label` is its accessible name. */
export function Switch({
  checked,
  label,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-[26px] w-11 flex-none rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60 ${checked ? "bg-mint" : "bg-line"}`}
    >
      <span
        className="absolute top-[3px] left-[3px] h-5 w-5 rounded-full bg-white shadow transition-transform"
        style={checked ? { transform: "translateX(18px)" } : undefined}
      />
    </button>
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

const FIELD_LABEL_CLASS = "text-xs font-extrabold tracking-wide text-ink-soft";

/** A labelled form row. `htmlFor` ties the label to its input; `labelId`
 * instead renders the label as a `<span id>` for a control named through
 * `aria-labelledby` (a picker button or a `role="group"`), which must never
 * sit in a `<label>`. `required` adds a visual `*` kept out of the
 * accessible name. */
export function Field({
  label,
  htmlFor,
  labelId,
  required = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  labelId?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const mark = required && <span aria-hidden="true"> *</span>;
  return (
    <div className="flex flex-col gap-1.5">
      {labelId ? (
        <span id={labelId} className={FIELD_LABEL_CLASS}>
          {label}
          {mark}
        </span>
      ) : (
        // The mark sits beside the <label>, so even text-based label lookups see only the name.
        <span className={FIELD_LABEL_CLASS}>
          <label htmlFor={htmlFor}>{label}</label>
          {mark}
        </span>
      )}
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

const FIELD_HINT_CLASS = "text-[12.5px] text-ink-soft";
const FIELD_ERROR_CLASS = "text-[12.5px] font-semibold text-danger";

/** A text input with an optional hint and at most one inline error below it,
 * both referenced by `aria-describedby`. */
function DescribedTextField({
  label,
  hint,
  error,
  input,
}: {
  label: string;
  hint?: string;
  error: string | null;
  input: (props: { id: string; "aria-invalid": true | undefined; "aria-describedby": string | undefined }) => ReactNode;
}) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <Field label={label} htmlFor={inputId}>
      {input({ id: inputId, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy || undefined })}
      {hint && (
        <p id={hintId} className={FIELD_HINT_CLASS}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className={FIELD_ERROR_CLASS}>
          {error}
        </p>
      )}
    </Field>
  );
}

/** A price in zł: `value` is the raw input text (see `parsePrice`); an invalid
 * amount shows `PRICE_ERROR` inline, and the host blocks submit. */
export function PriceField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (raw: string) => void;
  hint?: string;
}) {
  const error = parsePrice(value) === undefined ? PRICE_ERROR : null;
  return (
    <DescribedTextField
      label={label}
      hint={hint}
      error={error}
      input={(aria) => (
        <input
          {...aria}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="np. 25,50"
          className={`${INPUT_CLASS} w-36`}
        />
      )}
    />
  );
}

/** An optional https payment link: `value` is the raw input text (see
 * `parsePaymentUrl`). Shows one error at a time — the format or length error
 * for an invalid link, else "Link wymaga ceny" when a valid link has
 * `priceMissing` — and the host blocks submit (`parsePayment`). */
export function PaymentUrlField({
  label,
  value,
  onChange,
  hint,
  priceMissing,
}: {
  label: string;
  value: string;
  onChange: (raw: string) => void;
  hint?: string;
  priceMissing: boolean;
}) {
  const parsed = parsePaymentUrl(value);
  const error =
    parsed === undefined
      ? value.trim().length > MAX_PAYMENT_URL_LENGTH
        ? PAYMENT_URL_LENGTH_ERROR
        : PAYMENT_URL_ERROR
      : parsed !== null && priceMissing
        ? PAYMENT_URL_REQUIRES_PRICE_ERROR
        : null;
  return (
    <DescribedTextField
      label={label}
      hint={hint}
      error={error}
      input={(aria) => (
        <input
          {...aria}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://"
          className={`${INPUT_CLASS} w-full`}
        />
      )}
    />
  );
}

export interface PaidFieldsValue {
  /** Raw input texts; `parsePayment` turns them into the request values. */
  price: string;
  paymentUrl: string;
}

/** "Zajęcia płatne": unchecked (the default for a blank price and link) means
 * free and hides the price and link; unchecking clears both, so a hidden field
 * never carries a value. A price or link set from outside (a Circle default,
 * an edited paid term) checks the box. */
export function PaidFields({
  value,
  onChange,
  priceLabel,
  paymentUrlHint,
}: {
  value: PaidFieldsValue;
  onChange: (next: PaidFieldsValue) => void;
  priceLabel: string;
  paymentUrlHint?: string;
}) {
  const fieldsId = useId();
  const hasValue = value.price.trim() !== "" || value.paymentUrl.trim() !== "";
  const [paid, setPaid] = useState(hasValue);
  // Adjusting state during render: a prefill arriving after mount opens the fields.
  if (hasValue && !paid) setPaid(true);

  function toggle(checked: boolean) {
    setPaid(checked);
    if (!checked) onChange({ price: "", paymentUrl: "" });
  }

  return (
    <>
      <label className="flex items-center gap-2.5 text-sm font-semibold text-ink">
        <input
          type="checkbox"
          checked={paid}
          onChange={(e) => toggle(e.target.checked)}
          aria-controls={paid ? fieldsId : undefined}
          className="h-4 w-4 accent-primary"
        />
        Zajęcia płatne
      </label>
      {paid && (
        <div id={fieldsId} className="grid grid-cols-1 gap-3">
          <PriceField label={priceLabel} value={value.price} onChange={(price) => onChange({ ...value, price })} />
          <PaymentUrlField
            label="Link do płatności (opcjonalnie)"
            value={value.paymentUrl}
            onChange={(paymentUrl) => onChange({ ...value, paymentUrl })}
            hint={paymentUrlHint}
            priceMissing={parsePrice(value.price) === null}
          />
        </div>
      )}
    </>
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
  // Captured on first render, before a child's autoFocus moves focus; no document on the server.
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement));
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
