import { useState } from "react";
import { createRsvp, guestProfileIdKey, type RsvpResponse } from "../../api/groups";

/**
 * `.kg-*`-token-restyled `ModalSheet`/`Field` (same structure/behavior as
 * `PanelPage.tsx`'s Tailwind version — bottom-sheet on mobile, centered
 * ≥520px, dim overlay, ✕ close) — kept as a standalone component instead
 * of importing PanelPage's Tailwind version, since this page deliberately
 * stays on `.kg-*` CSS, not Tailwind (per `frontend/css.md`, confirmed
 * out of scope to migrate).
 */
export function RsvpDialog({
  groupId,
  termId,
  onClose,
  onSubmitted,
}: {
  groupId: number;
  termId: number;
  onClose: () => void;
  onSubmitted: (rsvp: RsvpResponse) => void;
}) {
  const [guardianName, setGuardianName] = useState("");
  const [childCount, setChildCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!guardianName.trim()) {
      setFormError("Podaj imię");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const rsvp = await createRsvp(groupId, {
        term_id: termId,
        guardian_name: guardianName.trim(),
        child_count: childCount,
      });
      localStorage.setItem(guestProfileIdKey(groupId, termId), String(rsvp.user_profile_id));
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

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          <label htmlFor="rsvp-name" style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-soft)" }}>
            Imię
          </label>
          <input
            id="rsvp-name"
            className="kg-input"
            placeholder="np. Ania Kowalska"
            value={guardianName}
            onChange={(e) => setGuardianName(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          <label htmlFor="rsvp-children" style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-soft)" }}>
            Liczba dzieci
          </label>
          <input
            id="rsvp-children"
            className="kg-input"
            type="number"
            min={0}
            value={childCount}
            onChange={(e) => setChildCount(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>

        {formError && <div style={{ color: "#B4443A", fontSize: 12, marginBottom: 10 }}>{formError}</div>}

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
