import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CloseIcon } from "./panelIcons";

/* ---------------- małe komponenty pomocnicze (wydzielone z PanelPage.tsx) ---------------- */

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

export function ModalSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(20,28,24,0.55)] min-[520px]:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full max-w-[430px] overflow-y-auto rounded-t-[24px] bg-paper p-5 min-[520px]:max-h-[80vh] min-[520px]:rounded-[24px]"
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
