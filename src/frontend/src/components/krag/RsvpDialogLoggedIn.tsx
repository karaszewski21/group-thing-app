import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyFamilies, type FamilyOut } from "../../api/families";
import { createRsvp, type RsvpResponse } from "../../api/groups";
import { Field } from "../../pages/panel/panelComponents";
import { ModalSheet } from "./ModalSheet";

/**
 * Logged-in variant of `RsvpDialog` (Thread 3 / R7). Separate component per
 * variant per `frontend/components.md` — this one never asks for a name
 * (the profile `display_name` is authoritative) and never writes the
 * `guest_profile_id` localStorage key (the logged-in "already signed up"
 * state is server-derived — D5). `ModalSheet`/`Field` (Tailwind) shared with
 * `RsvpDialog`; `kg-input`/`kg-btn-*`/`kg-fulfill`/`kg-error` for form
 * controls to match the rest of the term page.
 * Submit stays disabled until `displayName` has loaded: the RSVP endpoint
 * falls back to an anonymous signup when the token doesn't resolve, so a
 * placeholder name could create a junk attendee.
 */
export function RsvpDialogLoggedIn({
  groupId,
  termId,
  displayName,
  onClose,
  onSubmitted,
}: {
  groupId: number;
  termId: number;
  displayName: string | null;
  onClose: () => void;
  onSubmitted: (rsvp: RsvpResponse) => void;
}) {
  const [family, setFamily] = useState<FamilyOut | null>(null);
  const [childCount, setChildCount] = useState(0);
  const [skipBanner, setSkipBanner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
      const rsvp = await createRsvp(groupId, {
        term_id: termId,
        guardian_name: displayName,
        child_count: childCount,
      });
      onSubmitted(rsvp);
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
              className="kg-input"
              type="number"
              min={0}
              value={childCount}
              onChange={(e) => setChildCount(Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
        </div>
      ) : (
        <div className="kg-fulfill mb-3.5">
          <p className="mb-1 text-[13px] font-bold">Dodaj rodzinę, aby uzupełnić liczbę dzieci</p>
          <p className="mb-2.5 text-xs text-ink-soft">
            Liczbę dzieci uzupełnimy automatycznie z Twojego domu.
          </p>
          <div className="flex items-center gap-2">
            <Link to="/panel" className="kg-btn-primary inline-block no-underline">
              Przejdź do „Mój dom”
            </Link>
            <button className="kg-btn-ghost" type="button" onClick={() => setSkipBanner(true)}>
              Pomiń
            </button>
          </div>
        </div>
      )}

      {formError && <div className="kg-error">{formError}</div>}

      <button
        className="kg-btn-primary w-full px-3.5 py-2.5 text-[13px]"
        disabled={busy || displayName === null}
        onClick={() => void handleSubmit()}
      >
        Zapisz się
      </button>
    </ModalSheet>
  );
}
