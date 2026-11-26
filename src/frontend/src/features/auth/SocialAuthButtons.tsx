import type { AuthTab } from "../../auth/authPaths";
import { useGoogleSignIn } from "./useGoogleSignIn";

/** The "Sign in with Google" button above the email form, then a reserved
 * status line (or the error) and the "lub emailem" divider. Renders nothing
 * while Google login is unavailable, except an error left by a failed sign-in.
 * On success the host (`/login`'s AuthGuard, or `AuthSheet`) reacts to the token. */
export function SocialAuthButtons({ tab, onSwitchToLogin }: { tab: AuthTab; onSwitchToLogin: () => void }) {
  const { status, slotRef, error } = useGoogleSignIn(tab);

  if (status === "hidden" && !error) return null;

  const alert = error && (
    <div role="alert" className="mt-2 rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
      {error.message}
      {error.isConflict && tab === "register" && (
        <>
          {" "}
          <button type="button" onClick={onSwitchToLogin} className="font-semibold underline">
            Zaloguj się
          </button>
        </>
      )}
    </div>
  );

  if (status === "hidden") return <div className="mb-4">{alert}</div>;

  return (
    <div className="mb-4">
      <div className="flex min-h-11 justify-center">
        {status === "loading" ? (
          <div aria-hidden="true" className="h-11 w-full max-w-[400px] animate-pulse rounded-full bg-line" />
        ) : (
          <div ref={slotRef} className="flex w-full justify-center" />
        )}
      </div>
      {alert || <p role="status" className="mt-2 min-h-4.5 text-center text-xs text-ink-soft" />}
      <div className="mt-1 flex items-center gap-2.5 text-[13px] font-bold text-ink-soft">
        <span className="h-px flex-1 bg-line" />
        lub emailem
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
