import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyFamilies, type FamilyOut } from "../../api/families";
import { createRsvp, type RsvpResponse } from "../../api/groups";

/**
 * Logged-in variant of `RsvpDialog` (Thread 3 / R7). Separate component per
 * variant per `frontend/components.md` — this one never asks for a name
 * (the profile `display_name` is authoritative) and never writes the
 * `guest_profile_id` localStorage key (the logged-in "already signed up"
 * state is server-derived — D5). `.kg-*` styling, not Tailwind
 * (`frontend/css.md`); overlay/sheet inline styles mirror `RsvpDialog`.
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
  displayName: string;
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
    <div
      className="kg-modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(20,28,24,0.55)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Zapisz się na zajęcia"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          background: "var(--paper)",
          borderRadius: "24px 24px 0 0",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ fontFamily: "Fraunces,Georgia,serif", fontSize: 18, fontWeight: 600 }}>
            Zapisz się na zajęcia
          </h3>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{
              border: "none",
              background: "var(--cream)",
              color: "var(--ink-soft)",
              borderRadius: "50%",
              width: 34,
              height: 34,
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: 13.5, color: "var(--ink-soft)", marginBottom: 14 }}>
          Zapisujesz się jako <strong style={{ color: "var(--ink)" }}>{displayName}</strong>
        </p>

        {showNumericField ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            <label
              htmlFor="rsvp-li-children"
              style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-soft)" }}
            >
              Liczba dzieci
            </label>
            <input
              id="rsvp-li-children"
              className="kg-input"
              type="number"
              min={0}
              value={childCount}
              onChange={(e) => setChildCount(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
        ) : (
          <div className="kg-fulfill" style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
              Dodaj rodzinę, aby uzupełnić liczbę dzieci
            </p>
            <p style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 10 }}>
              Liczbę dzieci uzupełnimy automatycznie z Twojego domu.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Link
                to="/panel"
                className="kg-btn-primary"
                style={{ textDecoration: "none", display: "inline-block" }}
              >
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
          className="kg-btn-primary"
          style={{ width: "100%", padding: "10px 14px", fontSize: 13 }}
          disabled={busy}
          onClick={() => void handleSubmit()}
        >
          Zapisz się
        </button>
      </div>
    </div>
  );
}
