import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthGateLinks } from "../../components/krag/AuthGateSheet";
import { JoinPrivateGroupDialog } from "../../components/krag/JoinPrivateGroupDialog";
import type { PublicCircleResponse } from "../../api/groups";
import { CSS } from "./TermPage";
import { GroupHeader } from "./components/GroupHeader";

/**
 * Rendered by `TermAccessBoundary` when a `PRIVATE` Circle's
 * `access.can_view_content` is `false` — the caller is neither a standing
 * member nor the organizer (or, `access.can_join` case, isn't authenticated
 * at all). Never shows any Term/family/exchange content — that's exactly
 * the leak this component exists to prevent (see `access.md`'s note in
 * `GroupAccessResponse`'s docstring: a PRIVATE group's reduced
 * `PublicCircleResponse` already has no `next_term`/`guardians`, and this
 * component doesn't call any other data endpoint either).
 *
 * `onJoined` lets `TermAccessBoundary` re-resolve access after a successful
 * "Dołącz na stałe" submit, so the boundary can switch straight to the
 * member content without a full page reload.
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

  // Same font-loading as `PrivateTermView`/`PublicTermView` — this screen
  // can be the very first thing a visitor's session ever renders (a shared
  // PRIVATE-group link), so it can't rely on an earlier view having already
  // appended the stylesheet.
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Karla:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
    return () => {
      l.parentNode?.removeChild(l);
    };
  }, []);

  return (
    <div className="kg-stage">
      <style>{CSS}</style>
      <div className="kg-app">
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
      </div>
    </div>
  );
}
