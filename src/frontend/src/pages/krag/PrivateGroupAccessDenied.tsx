import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
  const location = useLocation();
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
                // (unlike the term-scoped RSVP gate), so this reuses the same
                // login/register `<Link>` markup pattern used elsewhere on
                // this page's other gates.
                <div style={{ marginTop: 12 }}>
                  <Link
                    to={`/login?returnTo=${encodeURIComponent(location.pathname)}`}
                    className="kg-btn-primary"
                    style={{
                      display: "block",
                      textAlign: "center",
                      width: "100%",
                      padding: "11px 14px",
                      fontSize: 13,
                      marginBottom: 10,
                    }}
                  >
                    Zaloguj się
                  </Link>
                  <p style={{ fontSize: 12, color: "var(--ink-soft)", textAlign: "center" }}>
                    Nie masz konta?{" "}
                    <Link to="/register" style={{ fontWeight: 700, color: "var(--mint, #1b8168)" }}>
                      Zarejestruj się
                    </Link>
                  </p>
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
