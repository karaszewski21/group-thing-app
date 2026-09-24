import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { withdrawJoinRequest, type PublicCircleResponse } from "../../api/groups";
import { AuthGateLinks } from "../../components/krag/AuthGateSheet";
import { RequestAccessDialog } from "../../components/krag/RequestAccessDialog";
import { KragStage } from "./components/KragStage";
import { GroupHeader } from "./components/GroupHeader";
import type { PrivateGate } from "./termAccess";

const BUTTON_STYLE = { padding: "10px 18px", fontSize: 13 } as const;
const BODY_STYLE = { fontSize: 13.5, color: "var(--ink-soft)", marginTop: 10 } as const;
const REFRESH_ERROR = "Nie udało się odświeżyć strony — spróbuj ponownie.";

/**
 * Rendered by `TermPage` when the caller can't see a PRIVATE group's
 * content. Shows only the group's name and organizer — never term,
 * attendee or exchange data — plus the one step the caller can take next.
 * Which step that is comes only from the server (`gate`); every action
 * ends in `refetch()`. `stale` means `gate` was resolved for another token
 * and the fetch for the current one failed, so only a retry is offered.
 */
export function PrivateGroupGate({
  groupId,
  termId,
  group,
  gate,
  refetch,
  refreshError,
  stale,
}: {
  groupId: number;
  termId?: number;
  group: PublicCircleResponse;
  gate: PrivateGate;
  refetch: () => Promise<void>;
  refreshError: string | null;
  stale: boolean;
}) {
  const navigate = useNavigate();
  const requestTriggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [createConflict, setCreateConflict] = useState(false);
  const [checking, setChecking] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  // The request id whose withdraw failed; the alert shows only while that
  // same request is still the pending one.
  const [withdrawFailedFor, setWithdrawFailedFor] = useState<number | null>(null);

  const isPending = !stale && gate.kind === "pending";
  useEffect(() => {
    if (!isPending) return;
    function onVisibilityChange() {
      if (document.visibilityState === "visible") void refetch();
    }
    function onFocus() {
      void refetch();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isPending, refetch]);

  async function check() {
    setWithdrawFailedFor(null);
    setChecking(true);
    try {
      await refetch();
    } finally {
      setChecking(false);
    }
  }

  async function withdraw(requestId: number) {
    setWithdrawing(true);
    setWithdrawFailedFor(null);
    try {
      await withdrawJoinRequest(groupId, requestId);
      await refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await refetch();
      else setWithdrawFailedFor(requestId);
    } finally {
      setWithdrawing(false);
    }
  }

  function openDialog() {
    setCreateConflict(false);
    setShowDialog(true);
  }

  function closeDialog() {
    setShowDialog(false);
    requestTriggerRef.current?.focus();
  }

  function requestButton(label: string) {
    return (
      <button
        ref={requestTriggerRef}
        className="kg-btn-primary"
        style={{ ...BUTTON_STYLE, marginTop: 12 }}
        onClick={openDialog}
      >
        {label}
      </button>
    );
  }

  function checkButton(label: string) {
    return (
      <button
        className="kg-btn-primary"
        style={BUTTON_STYLE}
        disabled={checking}
        aria-busy={checking}
        onClick={() => void check()}
      >
        {checking ? "Sprawdzanie…" : label}
      </button>
    );
  }

  let body: ReactNode;
  if (stale) {
    body = (
      <div style={{ marginTop: 12 }}>
        <div className="kg-error" role="alert">
          {REFRESH_ERROR}
        </div>
        {checkButton("Spróbuj ponownie")}
      </div>
    );
  } else if (gate.kind === "loginRequired") {
    body = (
      <>
        <p style={BODY_STYLE}>
          Zajęcia i lista uczestników są widoczne tylko dla członków. Zaloguj się, aby poprosić organizatora o
          dostęp.
        </p>
        <div style={{ marginTop: 12 }}>
          <AuthGateLinks />
        </div>
      </>
    );
  } else if (gate.kind === "canRequest") {
    body = (
      <>
        <p style={BODY_STYLE}>
          Zajęcia i lista uczestników są widoczne tylko dla członków. Poproś organizatora o dostęp — dostaniesz
          powiadomienie, gdy podejmie decyzję.
        </p>
        {requestButton("Poproś o dostęp")}
        {createConflict && !group.organizer_display_name && (
          <div className="kg-error" role="alert" style={{ marginTop: 10 }}>
            Ta grupa nie ma teraz organizatora — nie można wysłać prośby.
          </div>
        )}
      </>
    );
  } else if (gate.kind === "pending") {
    body = (
      <>
        <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>Strona odświeży się sama, gdy tu wrócisz.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {checkButton("Sprawdź ponownie")}
          <button
            className="kg-btn-ghost"
            style={BUTTON_STYLE}
            disabled={withdrawing}
            aria-busy={withdrawing}
            onClick={() => void withdraw(gate.requestId)}
          >
            {withdrawing ? "Wycofywanie…" : "Wycofaj prośbę"}
          </button>
        </div>
        {withdrawFailedFor === gate.requestId && (
          <div className="kg-error" role="alert" style={{ marginTop: 10 }}>
            Nie udało się wycofać prośby — spróbuj ponownie
          </div>
        )}
      </>
    );
  } else {
    body = (
      <>
        <p style={BODY_STYLE}>
          Organizator nie zatwierdził tym razem Twojej prośby. Jeśli to pomyłka, możesz poprosić ponownie.
        </p>
        {requestButton("Poproś ponownie")}
      </>
    );
  }

  const canOpenDialog = !stale && (gate.kind === "canRequest" || gate.kind === "rejected");

  return (
    <KragStage
      overlay={
        canOpenDialog &&
        showDialog && (
          <RequestAccessDialog
            groupId={groupId}
            termId={termId}
            groupName={group.name}
            onClose={closeDialog}
            onSubmitted={() => {
              setShowDialog(false);
              setWithdrawFailedFor(null);
              headingRef.current?.focus();
              void refetch();
            }}
            onConflict={() => {
              setShowDialog(false);
              setCreateConflict(true);
              headingRef.current?.focus();
              void refetch();
            }}
          />
        )
      }
    >
      <GroupHeader
        eyebrow="Krąg"
        title={group.name}
        onBack={() => navigate(-1)}
        subtitle={group.organizer_display_name ? `Prowadzi: ${group.organizer_display_name}` : "Brak organizatora"}
      />

      <div className="kg-card">
        <h2 ref={headingRef} tabIndex={-1} style={{ fontSize: 17 }}>
          <span aria-hidden="true">🔒 </span>Ta grupa jest prywatna
        </h2>
        <div role="status" aria-live="polite">
          {isPending && (
            <div className="kg-status-line">
              <span aria-hidden="true">⏳ </span>Prośba wysłana — czeka na akceptację organizatora
            </div>
          )}
        </div>
        {body}
        {!stale && refreshError !== null && (
          <div className="kg-error" role="alert" style={{ marginTop: 10, marginBottom: 0 }}>
            {REFRESH_ERROR}
          </div>
        )}
      </div>
    </KragStage>
  );
}
