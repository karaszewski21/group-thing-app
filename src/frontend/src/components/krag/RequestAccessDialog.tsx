import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { createJoinRequest } from "../../api/groups";
import { serverMessageOr } from "../../api/problem";
import { useRegisterOpenSheet } from "../shared/openSheets";
import { BTN_GHOST, BTN_PRIMARY, BTN_SM, ERROR_TEXT } from "./kragStyles";
import { trapFocus } from "./trapFocus";

type RequestFlow = { status: "idle" } | { status: "submitting" } | { status: "failed"; message: string };

/**
 * Confirm-only bottom sheet for asking a PRIVATE group's organizer for
 * access — the requester's name comes from their account, so there are no
 * fields. A 409 (no organizer, or already a member) is handed to
 * `onConflict` so the gate can refetch and explain; any other error stays
 * in the sheet. Tab/Shift+Tab wrap within the sheet while it is open.
 */
export function RequestAccessDialog({
  groupId,
  termId,
  groupName,
  onClose,
  onSubmitted,
  onConflict,
}: {
  groupId: string;
  termId?: string;
  groupName: string;
  onClose: () => void;
  onSubmitted: () => void;
  onConflict: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [flow, setFlow] = useState<RequestFlow>({ status: "idle" });
  const busy = flow.status === "submitting";
  useRegisterOpenSheet(true);

  useEffect(() => {
    submitRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab") trapFocus(e, dialogRef.current);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  function close() {
    if (!busy) onClose();
  }

  async function handleSubmit() {
    setFlow({ status: "submitting" });
    try {
      await createJoinRequest(groupId, termId);
      onSubmitted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        onConflict();
        return;
      }
      setFlow({ status: "failed", message: serverMessageOr(err, "Nie udało się wysłać prośby — spróbuj ponownie") });
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "var(--color-scrim)",
      }}
      onClick={close}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          background: "var(--color-paper)",
          borderRadius: "24px 24px 0 0",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 id={titleId} style={{ fontFamily: "'Bricolage Grotesque', system-ui, sans-serif", fontSize: 18, fontWeight: 600 }}>
            Poprosić o dostęp?
          </h3>
          <button
            onClick={close}
            disabled={busy}
            aria-label="Zamknij"
            style={{
              border: "none",
              background: "var(--color-cream)",
              color: "var(--color-ink-soft)",
              borderRadius: "50%",
              width: 34,
              height: 34,
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: 13, color: "var(--color-ink-soft)", marginBottom: 16 }}>
          Wyślesz prośbę do organizatora grupy „<strong>{groupName}</strong>”. Zobaczy Twoje imię z konta i
          zdecyduje, czy dodać Cię do grupy.
        </p>

        {flow.status === "failed" && (
          <div className={`${ERROR_TEXT}`} role="alert">
            {flow.message}
          </div>
        )}

        <button
          ref={submitRef}
          className={`${BTN_PRIMARY} ${BTN_SM}`}
          style={{ width: "100%", padding: "10px 14px", fontSize: 13 }}
          disabled={busy}
          aria-busy={busy}
          onClick={() => void handleSubmit()}
        >
          {busy ? "Wysyłanie…" : "Wyślij"}
        </button>
        <button
          className={`${BTN_GHOST} ${BTN_SM}`}
          style={{ width: "100%", padding: "10px 14px", fontSize: 13, marginTop: 8 }}
          disabled={busy}
          onClick={close}
        >
          Anuluj
        </button>
      </div>
    </div>
  );
}
