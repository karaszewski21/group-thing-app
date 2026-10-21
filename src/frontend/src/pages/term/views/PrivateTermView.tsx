import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BTN_PRIMARY, CARD, ERROR_TEXT, PAGE_SHELL } from "../../../components/shared/uiStyles";
import { GroupHeader } from "../components/GroupHeader";
import type { CodeSheet } from "../hooks/useJoinCodeLink";
import { AuthGateLinks } from "../modals/AuthGateSheet";
import { JoinByCodeSheet } from "../modals/JoinByCodeSheet";
import type { PrivateViewState } from "../termViewState";

const BUTTON = `${BTN_PRIMARY} px-4.5 py-2.5 text-[13px]`;
const BODY = "mt-2.5 text-[13.5px] text-ink-soft";
const MEMBERS_ONLY = "Zajęcia i lista uczestników są widoczne tylko dla członków.";
const REFRESH_ERROR = "Nie udało się odświeżyć strony — spróbuj ponownie.";

/**
 * A PRIVATE group's term page for a caller who can't see its content. Shows
 * only the group's name and organizer — never term, attendee or exchange
 * data — plus the one step `view` allows: log in, enter the organizer's
 * access code, or retry a failed refresh. The code sheet's state and the join
 * belong to `useJoinCodeLink`.
 */
export function PrivateTermView({
  view,
  onRetry,
  hasPendingCode,
  codeSheet,
  onOpenSheet,
  onCloseSheet,
  onJoin,
}: {
  view: PrivateViewState;
  onRetry: () => Promise<void>;
  hasPendingCode: boolean;
  codeSheet: CodeSheet | null;
  onOpenSheet: () => void;
  onCloseSheet: () => void;
  onJoin: (code: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const { group } = view;

  return (
    <div className={PAGE_SHELL}>
      <GroupHeader
        eyebrow="Krąg"
        title={group.name}
        onBack={() => navigate(-1)}
        subtitle={group.organizer_display_name ? `Prowadzi: ${group.organizer_display_name}` : "Brak organizatora"}
      />

      <div className={`${CARD} mx-4.5 mt-4.5 mb-6`}>
        <h2 className="text-[17px]">
          <span aria-hidden="true">🔒 </span>Ta grupa jest prywatna
        </h2>
        {view.kind === "loginRequired" && <LoginRequiredStep hasPendingCode={hasPendingCode} />}
        {view.kind === "enterCode" && <EnterCodeStep onOpenSheet={onOpenSheet} />}
        {view.kind === "refreshFailed" && <RefreshFailedStep onRetry={onRetry} />}
        {view.kind !== "refreshFailed" && view.refreshError !== null && (
          <div className="mt-2.5 text-xs text-danger" role="alert">
            {REFRESH_ERROR}
          </div>
        )}
      </div>

      {view.kind === "enterCode" && codeSheet && (
        <JoinByCodeSheet
          key={codeSheet.initialCode}
          initialCode={codeSheet.initialCode}
          autoSubmit={codeSheet.autoSubmit}
          onSubmit={onJoin}
          onClose={onCloseSheet}
        />
      )}
    </div>
  );
}

function LoginRequiredStep({ hasPendingCode }: { hasPendingCode: boolean }) {
  return (
    <>
      <p className={BODY}>
        {MEMBERS_ONLY}{" "}
        {hasPendingCode ? "Masz kod? Zaloguj się, żeby go użyć." : "Zaloguj się, aby wpisać kod dostępu."}
      </p>
      <div className="mt-3">
        <AuthGateLinks />
      </div>
    </>
  );
}

function EnterCodeStep({ onOpenSheet }: { onOpenSheet: () => void }) {
  return (
    <>
      <p className={BODY}>{MEMBERS_ONLY} Wpisz kod dostępu od organizatora, aby dołączyć.</p>
      <button className={`${BUTTON} mt-3`} onClick={onOpenSheet}>
        Mam kod dostępu
      </button>
    </>
  );
}

/** The gate was resolved for another token and the fetch for the current one
 * failed: only a retry is offered, never a step that may no longer apply. */
function RefreshFailedStep({ onRetry }: { onRetry: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);

  async function retry() {
    setChecking(true);
    try {
      await onRetry();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mt-3">
      <div className={ERROR_TEXT} role="alert">
        {REFRESH_ERROR}
      </div>
      <button className={BUTTON} disabled={checking} aria-busy={checking} onClick={() => void retry()}>
        {checking ? "Sprawdzanie…" : "Spróbuj ponownie"}
      </button>
    </div>
  );
}
