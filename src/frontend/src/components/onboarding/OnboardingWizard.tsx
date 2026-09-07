import { useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Per-step imperative bridge into the wizard shell's "Dalej"/"Zakończ"
 * button: a step body calls `setSubmit` (typically from a `useEffect`) to
 * register the async work that should run when the wizard advances past it
 * — e.g. POSTing an accumulated draft list. Passing `null` (or never
 * calling `setSubmit`) makes the step a pure local-draft step with nothing
 * to persist (see `guestSteps.tsx`'s frontend-only family-name step).
 */
export interface StepContext {
  setSubmit: (submit: (() => Promise<void> | void) | null) => void;
  busy: boolean;
}

export interface Step {
  id: string;
  title: string;
  render: (ctx: StepContext) => ReactNode;
  isSkippable?: boolean;
}

interface OnboardingWizardProps {
  steps: Step[];
  onSkip: () => void;
  onComplete: () => void;
}

/**
 * Generic, prop-configured onboarding shell reused by both the GUEST and
 * ORGANIZER flows (`standards/frontend/components.md`) — GUEST/ORGANIZER
 * differ only in which `Step[]` is passed in, not in wizard behavior.
 * Reuses the `RegisterPage`/`LoginPage` card shell verbatim.
 */
export function OnboardingWizard({ steps, onSkip, onComplete }: OnboardingWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitRef = useRef<(() => Promise<void> | void) | null>(null);

  const total = steps.length;
  const current = steps[stepIndex];
  const isLast = stepIndex === total - 1;

  function setSubmit(submit: (() => Promise<void> | void) | null) {
    submitRef.current = submit;
  }

  async function handleAdvance() {
    setError(null);
    setBusy(true);
    try {
      if (submitRef.current) {
        await submitRef.current();
      }
      if (isLast) {
        onComplete();
      } else {
        submitRef.current = null;
        setStepIndex((i) => i + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się zapisać kroku");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-10 font-sans text-ink">
      <div className="relative w-full max-w-[440px] rounded-[22px] border border-line bg-paper p-10">
        <button
          type="button"
          onClick={onSkip}
          aria-label="Zamknij"
          className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:bg-cream"
        >
          ✕
        </button>

        <h1 className="mb-2 text-center font-serif text-2xl font-semibold text-ink">
          Krąg <span className="text-mint">grupy</span>
        </h1>

        <div className="mb-1.5 flex justify-center gap-2">
          {steps.map((step, i) => (
            <span
              key={step.id}
              className={`h-2.5 w-2.5 rounded-full ${i === stepIndex ? "bg-mint" : "bg-line"}`}
            />
          ))}
        </div>
        <p
          role="status"
          aria-label={`Krok ${stepIndex + 1} z ${total}`}
          className="mb-6 text-center text-xs font-bold text-ink-soft"
        >
          Krok {stepIndex + 1} z {total}
        </p>

        <h2 className="mb-4 text-base font-semibold text-ink">{current.title}</h2>

        <div className="mb-6">{current.render({ setSubmit, busy })}</div>

        {error && (
          <div className="mb-4 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger">{error}</div>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="inline-flex h-[38px] flex-none items-center justify-center rounded-full border border-line bg-white px-[15px] text-[13.5px] font-bold text-ink shadow-[0_3px_10px_-6px_rgba(30,46,39,0.4)] disabled:opacity-60"
          >
            Pomiń
          </button>
          <button
            type="button"
            onClick={() => void handleAdvance()}
            disabled={busy}
            className="rounded-[13px] bg-mint px-4 py-3 text-[13.5px] font-extrabold text-white shadow-[0_8px_18px_-10px_rgba(27,129,104,0.85)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {isLast ? "Zakończ ✓" : "Dalej →"}
          </button>
        </div>
      </div>
    </div>
  );
}
