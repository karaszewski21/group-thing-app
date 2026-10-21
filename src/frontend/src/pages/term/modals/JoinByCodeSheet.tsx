import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { parseJoinCode } from "../../../utils/joinCode";
import { ModalSheet } from "../../../components/shared/ModalSheet";
import { BTN_GHOST, BTN_LG, BTN_PRIMARY } from "../../../components/shared/uiStyles";
import { CodeDigitsInput } from "../components/CodeDigitsInput";

const INVALID_CODE = "Kod ma 6 cyfr";
const JOIN_FAILED = "Nie udało się dołączyć — spróbuj ponownie";

const CODE_LENGTH = 6;

/** `initialCode`'s digits, one per box; anything but a valid code starts empty. */
function toDigits(initialCode: string): string[] {
  const code = parseJoinCode(initialCode);
  return Array.from({ length: CODE_LENGTH }, (_, i) => (typeof code === "string" ? code[i] : ""));
}

/**
 * Bottom sheet where a logged-in visitor types the organizer's 6-digit
 * code to join a PRIVATE group, one box per digit (`CodeDigitsInput`).
 * `onSubmit` rejects with a user-facing message, shown in the alert slot
 * until the next edit. While a submit is in flight the sheet cannot close.
 * With `autoSubmit`, a valid `initialCode` is sent once on open.
 */
export function JoinByCodeSheet({
  initialCode,
  autoSubmit,
  onSubmit,
  onClose,
}: {
  initialCode: string;
  autoSubmit: boolean;
  onSubmit: (code: string) => Promise<void>;
  onClose: () => void;
}) {
  const hintId = useId();
  const errorId = useId();
  const busyRef = useRef(false);
  const autoSubmitted = useRef(false);
  const [digits, setDigits] = useState(() => toDigits(initialCode));
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const filled = digits.filter((d) => d !== "").length;
  const code = filled === CODE_LENGTH ? digits.join("") : null;
  // A partial code is not an error yet: only after blur or a submit attempt.
  const showInvalid = touched && filled > 0 && code === null;
  const message = serverError ?? (showInvalid ? INVALID_CODE : null);

  const submit = useCallback(
    async (value: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setServerError(null);
      try {
        await onSubmit(value);
      } catch (err) {
        setServerError(err instanceof Error && err.message ? err.message : JOIN_FAILED);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onSubmit],
  );

  useEffect(() => {
    if (!autoSubmit || autoSubmitted.current) return;
    autoSubmitted.current = true;
    const initial = parseJoinCode(initialCode);
    if (typeof initial === "string") void submit(initial);
  }, [autoSubmit, initialCode, submit]);

  function close() {
    if (!busyRef.current) onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (code !== null) void submit(code);
  }

  return (
    <ModalSheet title="Wpisz kod dostępu" onClose={close}>
      <form noValidate onSubmit={handleSubmit}>
        <CodeDigitsInput
          label="Kod dostępu"
          digits={digits}
          onChange={(next) => {
            setDigits(next);
            setServerError(null);
          }}
          onBlur={() => setTouched(true)}
          invalid={message !== null}
          describedBy={message !== null ? `${hintId} ${errorId}` : hintId}
        />
        <p id={hintId} className="mt-1.25 text-[11.5px] text-ink-soft">
          6 cyfr, np. 123 456
        </p>
        {message !== null && (
          <p id={errorId} role="alert" className="mt-2 text-xs font-semibold text-danger">
            {message}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button type="button" className={`${BTN_GHOST} ${BTN_LG} flex-1`} disabled={busy} onClick={close}>
            Anuluj
          </button>
          <button
            type="submit"
            className={`${BTN_PRIMARY} ${BTN_LG} flex-1`}
            disabled={busy || code === null}
            aria-busy={busy}
          >
            {busy ? "Dołączanie…" : "Dołącz"}
          </button>
        </div>
      </form>
    </ModalSheet>
  );
}
