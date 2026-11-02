import { useState, type FormEvent } from "react";
import { Link, useAppPathname, useAppSearch } from "../../../routing/navigation";
import type { EventResponse } from "../../../api/events";
import { authPath } from "../../../auth/authPaths";
import { ModalSheet } from "../../../components/shared/ModalSheet";
import { BTN_LG, BTN_PRIMARY, FIELD } from "../../../components/shared/uiStyles";
import dayjs from "../../../utils/dayjs";

const NAME_ID = "event-guest-name";
const HINT_ID = "event-guest-name-hint";
const ERROR_ID = "event-guest-name-error";

/** The anonymous visitor's sign-up: a name only. `onSubmit` rejects with
 * the Polish message shown under the field; logging in instead is a link
 * that comes back to this page. */
export function EventGuestSignUpSheet({
  event,
  onSubmit,
  onClose,
}: {
  event: EventResponse;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const pathname = useAppPathname();
  const search = useAppSearch();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <ModalSheet title="Zapisz się na wydarzenie" onClose={onClose}>
      <p className="-mt-2 mb-4 text-sm text-ink-soft">
        {event.name} · {dayjs(event.starts_at).format("ddd[.] D MMMM, HH:mm")}
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        <label htmlFor={NAME_ID} className="block text-[13px] font-bold text-ink">
          Twoje imię
        </label>
        <input
          id={NAME_ID}
          className={`${FIELD} mt-1.5 w-full`}
          autoComplete="given-name"
          maxLength={255}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${HINT_ID} ${ERROR_ID}` : HINT_ID}
        />
        <p id={HINT_ID} className="mt-1.5 text-xs text-ink-soft">
          Imię zobaczą inni na liście zapisanych.
        </p>
        {error && (
          <p id={ERROR_ID} role="alert" className="mt-1.5 text-xs font-semibold text-danger">
            {error}
          </p>
        )}
        <button type="submit" className={`${BTN_PRIMARY} ${BTN_LG} mt-4 w-full`} disabled={busy}>
          Zapisz się
        </button>
      </form>
      <p className="mt-3.5 text-center text-sm text-ink">
        Masz konto?{" "}
        <Link to={authPath("login", pathname + search)} className="font-extrabold text-primary-fg">
          Zaloguj się
        </Link>
      </p>
    </ModalSheet>
  );
}
