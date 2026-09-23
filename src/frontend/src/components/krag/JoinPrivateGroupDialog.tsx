import { useState } from "react";
import { joinPrivateGroup, type JoinGroupResponse } from "../../api/groups";

/**
 * Conscious clone of `RsvpDialog` — same `.kg-*`-token styling/structure,
 * same guardian-name + child-count fields, but calls `joinPrivateGroup`
 * (group-scoped, creates standing membership) instead of `createRsvp`
 * (term-scoped, creates a one-off attendance). Kept as its own component
 * rather than parameterizing `RsvpDialog` — the two dialogs' result
 * semantics differ enough (membership vs. attendance, no `guest_profile_id`
 * write here) that sharing one component would need branchy props for
 * every difference, per `standards/frontend/components.md`.
 */
export function JoinPrivateGroupDialog({
  groupId,
  onClose,
  onSubmitted,
}: {
  groupId: number;
  onClose: () => void;
  onSubmitted: (result: JoinGroupResponse) => void;
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
      const result = await joinPrivateGroup(groupId, {
        guardian_name: guardianName.trim(),
        child_count: childCount,
      });
      onSubmitted(result);
    } catch {
      setFormError("Nie udało się dołączyć — spróbuj ponownie");
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
        aria-label="Dołącz na stałe do grupy"
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
            Dołącz na stałe do grupy
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
          <label htmlFor="join-name" style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-soft)" }}>
            Imię
          </label>
          <input
            id="join-name"
            className="kg-input"
            placeholder="np. Ania Kowalska"
            value={guardianName}
            onChange={(e) => setGuardianName(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          <label htmlFor="join-children" style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-soft)" }}>
            Liczba dzieci
          </label>
          <input
            id="join-children"
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
          Dołącz
        </button>
      </div>
    </div>
  );
}
