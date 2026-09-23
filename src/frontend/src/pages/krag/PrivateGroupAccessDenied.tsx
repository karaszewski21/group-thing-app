import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthGateLinks } from "../../components/krag/AuthGateSheet";
import { JoinPrivateGroupDialog } from "../../components/krag/JoinPrivateGroupDialog";
import type { PublicCircleResponse } from "../../api/groups";
import { KragStage } from "./components/KragStage";
import { GroupHeader } from "./components/GroupHeader";

/**
 * Rendered by `TermPage` for every `PRIVATE` Circle. Never shows any
 * Term/attendee/exchange content — a PRIVATE group's reduced
 * `PublicCircleResponse` has no `next_term`/`guardians`, and this component
 * calls no other data endpoint. `onJoined` lets the page re-resolve access
 * after a successful "Dołącz na stałe" submit.
 */
export function PrivateGroupAccessDenied({
  groupId,
  group,
  canJoin,
  isLoggedIn,
  onJoined,
}: {
  groupId: number;
  group: PublicCircleResponse;
  canJoin: boolean;
  isLoggedIn: boolean;
  onJoined: () => void;
}) {
  const navigate = useNavigate();
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [joined, setJoined] = useState(false);

  return (
    <KragStage>
      <GroupHeader
        eyebrow="Krąg"
        title={group.name}
        onBack={() => navigate(-1)}
        subtitle={
          group.organizer_display_name
            ? `Prowadzi: ${group.organizer_display_name}`
            : "Brak organizatora"
        }
      />

      <div className="kg-card" role="status">
        {joined ? (
          <div className="kg-status-line" style={{ fontSize: 15 }}>
            ✓ Dołączono! Do zobaczenia na zajęciach.
          </div>
        ) : (
          <>
            <p>Ta grupa jest prywatna — mogą się do niej zapisać tylko stali członkowie.</p>
            {!canJoin ? null : isLoggedIn ? (
              <button
                className="kg-btn-primary"
                style={{ marginTop: 12, padding: "10px 18px", fontSize: 13 }}
                onClick={() => setShowJoinDialog(true)}
              >
                Dołącz na stałe
              </button>
            ) : (
              // Logged-out visitor: no guest path for a standing membership
              // (unlike the term-scoped RSVP gate), so the login/register
              // choice sits inline in the card instead of a bottom sheet.
              <div style={{ marginTop: 12 }}>
                <AuthGateLinks />
              </div>
            )}
          </>
        )}
      </div>

      {isLoggedIn && showJoinDialog && (
        <JoinPrivateGroupDialog
          groupId={groupId}
          onClose={() => setShowJoinDialog(false)}
          onSubmitted={() => {
            setShowJoinDialog(false);
            setJoined(true);
            onJoined();
          }}
        />
      )}
    </KragStage>
  );
}
