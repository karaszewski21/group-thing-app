import { useEffect, useState } from "react";
import { Link, useAppPathname } from "../../../routing/navigation";
import { getMyFamilies, type FamilyOut } from "../../../api/families";
import { createRsvp } from "../../../api/groups";
import { Field } from "../../../components/shared/appComponents";
import { ModalSheet } from "../../../components/shared/ModalSheet";
import { BTN_GHOST, BTN_PRIMARY, BTN_SM, ERROR_TEXT, FIELD, SUB_FORM } from "../../../components/shared/uiStyles";

/**
 * The term sign-up dialog for a logged-in parent: asks only for the child
 * count (the profile `display_name` is the attendee's name), prefilled from
 * their family. Submit stays disabled until `displayName` has loaded, so
 * the "Zapisujesz się jako" line is never blank.
 */
export function RsvpDialogLoggedIn({
  groupId,
  termId,
  displayName,
  onClose,
  onSubmitted,
}: {
  groupId: string;
  termId: string;
  displayName: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const pathname = useAppPathname();
  const [family, setFamily] = useState<FamilyOut | null>(null);
  const [childCount, setChildCount] = useState(0);
  const [skipBanner, setSkipBanner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Fetched on every mount: after "Wróć do terminu" the dialog is closed, and
  // reopening it picks up the children added in "Mój dom" for the prefill.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await getMyFamilies();
        if (!active) return;
        const first = res[0] ?? null;
        setFamily(first);
        setChildCount(first?.child_count ?? 0);
      } catch {
        // A failed families read just means no prefill — the "Pomiń"
        // numeric fallback still lets the user RSVP.
        if (active) setFamily(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // `child_count === 0` with a real family still shows the "dodaj rodzinę /
  // uzupełnij" banner on purpose: 0 children means there is nothing to prefill,
  // so the user is nudged to complete their household (or "Pomiń" to type a count).
  const hasChildPrefill = family !== null && family.child_count >= 1;
  const showNumericField = hasChildPrefill || skipBanner;

  async function handleSubmit() {
    if (displayName === null) return;
    setBusy(true);
    setFormError(null);
    try {
      await createRsvp(groupId, { term_id: termId, child_count: childCount });
      onSubmitted();
    } catch {
      setFormError("Nie udało się zapisać — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalSheet title="Zapisz się na zajęcia" onClose={onClose}>
      {displayName !== null && (
        <p className="mb-3.5 text-[13.5px] text-ink-soft">
          Zapisujesz się jako <strong className="text-ink">{displayName}</strong>
        </p>
      )}

      {showNumericField ? (
        <div className="mb-3.5">
          <Field label="Liczba dzieci">
            <input
              id="rsvp-li-children"
              className={`${FIELD}`}
              type="number"
              min={0}
              value={childCount}
              onChange={(e) => setChildCount(Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
        </div>
      ) : (
        <div className={`${SUB_FORM} mb-3.5`}>
          <p className="mb-1 text-[13px] font-bold">Dodaj rodzinę, aby uzupełnić liczbę dzieci</p>
          <p className="mb-2.5 text-xs text-ink-soft">
            Liczbę dzieci uzupełnimy automatycznie z Twojego domu.
          </p>
          <div className="flex items-center gap-2">
            <Link
              to={`/family?returnTo=${encodeURIComponent(pathname)}`}
              className={`${BTN_PRIMARY} ${BTN_SM} inline-block no-underline`}
            >
              Przejdź do „Mój dom”
            </Link>
            <button className={`${BTN_GHOST} ${BTN_SM}`} type="button" onClick={() => setSkipBanner(true)}>
              Pomiń
            </button>
          </div>
        </div>
      )}

      {formError && <div className={`${ERROR_TEXT}`}>{formError}</div>}

      <button
        className={`${BTN_PRIMARY} w-full px-3.5 py-2.5 text-[13px]`}
        disabled={busy || displayName === null}
        onClick={() => void handleSubmit()}
      >
        Zapisz się
      </button>
    </ModalSheet>
  );
}
