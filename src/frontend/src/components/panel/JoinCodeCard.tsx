import { useId, useState, type ReactNode } from "react";
import type { GroupResponse } from "../../api/groups";
import type { JoinCodeStatus } from "../../hooks/useJoinCode";
import { useToast } from "../shared/useToast";
import { termPublicPath } from "../../pages/panel/panelHelpers";
import { formatJoinCode } from "../../utils/joinCode";
import { ConfirmDeleteDialog } from "../shared/ConfirmDeleteDialog";
import { Skeleton } from "../shared/Skeleton";

const BUTTON_BASE = "min-h-[44px] w-full rounded-[13px] px-4 py-[11px] text-[13.5px] font-extrabold";
const PRIMARY_CLASS = `${BUTTON_BASE} bg-mint text-white`;
const SECONDARY_CLASS = `${BUTTON_BASE} border-[1.5px] border-line bg-paper text-ink-soft`;
const TEXT_CLASS = "self-center p-1.5 text-[12.5px] font-bold text-ink-soft underline";

interface JoinCodeCardProps {
  group: GroupResponse;
  code: string | null;
  status: JoinCodeStatus;
  onRetry: () => Promise<void>;
  regenerate: () => Promise<void>;
  /** The term "Kopiuj link z kodem" points at; without one only the code is offered. */
  termId: string | null;
}

/** The organizer's access code for a PRIVATE group. Presentational: the host
 * page owns `useJoinCode` and passes its result in. A 403 or a disabled query
 * renders nothing. The link carries the code in the fragment, which browsers
 * never send to the server. */
export function JoinCodeCard({ group, code, status, onRetry, regenerate, termId }: JoinCodeCardProps) {
  const titleId = useId();
  const { toast, showToast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (status === "denied" || status === "idle") return null;

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(done);
    } catch {
      showToast("Nie udało się skopiować kodu");
    }
  }

  async function confirmRegenerate() {
    await regenerate();
    setConfirmOpen(false);
    showToast("Wygenerowano nowy kod");
  }

  let body: ReactNode;
  if (status === "ready" && code) {
    body = (
      <>
        <p className="rounded-[14px] bg-mint-soft py-2.5 text-center font-mono text-[30px] font-bold tracking-[.14em] text-[#12604D]">
          <span aria-hidden="true">{formatJoinCode(code)}</span>
          <span className="sr-only">{code.split("").join(" ")}</span>
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" onClick={() => void copy(code, "Skopiowano kod")} className={PRIMARY_CLASS}>
            Kopiuj kod
          </button>
          {termId && (
            <button
              type="button"
              onClick={() =>
                void copy(`${window.location.origin}${termPublicPath(group, termId)}#code=${code}`, "Skopiowano link")
              }
              className={SECONDARY_CLASS}
            >
              Kopiuj link z kodem
            </button>
          )}
          <button type="button" onClick={() => setConfirmOpen(true)} className={TEXT_CLASS}>
            Wygeneruj nowy kod
          </button>
        </div>
      </>
    );
  } else if (status === "error") {
    body = (
      <div className="py-2">
        <p role="alert" className="text-[12.5px] font-semibold text-danger">
          Nie udało się wczytać kodu dostępu.
        </p>
        <button
          type="button"
          onClick={() => void onRetry()}
          className="mt-3 rounded-xl border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-cream"
        >
          Spróbuj ponownie
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <span className="sr-only">Wczytywanie kodu dostępu…</span>
        <Skeleton tone="primary" className="h-[60px] rounded-[14px]" />
        <div className="mt-3 flex flex-col gap-2">
          <Skeleton className="h-[44px] rounded-[13px]" />
          <Skeleton className="h-[44px] rounded-[13px]" />
        </div>
      </>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={status === "loading" || undefined}
      className="mt-4 rounded-2xl border border-line bg-paper p-[15px]"
    >
      <h3 id={titleId} className="font-serif text-[15px] font-bold text-ink">
        Kod dostępu
      </h3>
      <p className="mb-2.5 mt-[3px] text-xs text-ink-soft">Podaj go osobom, które mają dołączyć do grupy.</p>
      {body}
      {confirmOpen && (
        <ConfirmDeleteDialog
          tone="primary"
          busyLabel="Generowanie…"
          title="Wygenerować nowy kod?"
          body="Stary kod przestanie działać. Osoby, które już dołączyły, zostają w grupie."
          confirmLabel="Wygeneruj nowy kod"
          fallbackError="Nie udało się wygenerować kodu — spróbuj ponownie"
          onConfirm={confirmRegenerate}
          onClose={() => setConfirmOpen(false)}
        />
      )}
      <div role="status" className="fixed bottom-[90px] left-1/2 z-[120] -translate-x-1/2">
        {toast && (
          <span className="block whitespace-nowrap rounded-full bg-ink px-5 py-[11px] text-sm font-semibold text-on-ink shadow-[0_14px_30px_-14px_var(--color-scrim)]">
            {toast}
          </span>
        )}
      </div>
    </section>
  );
}
