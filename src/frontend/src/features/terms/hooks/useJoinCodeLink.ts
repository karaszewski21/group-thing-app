import { useCallback, useEffect, useState } from "react";
import { useAppHash, useAppNavigate, useAppPathname, useAppSearch } from "../../../routing/navigation";
import { ApiError } from "../../../api/client";
import { useClientValue } from "../../../lib/useClientValue";
import { parseJoinCode } from "../../../utils/joinCode";
import type { TermViewState } from "../termViewState";

export type CodeSheet = { initialCode: string; autoSubmit: boolean };

const pendingCodeKey = (groupId: string) => `pendingJoinCode:${groupId}`;
const PENDING_CODE_TTL_MS = 60 * 60 * 1000;

/** The code a shared link carried here before login. sessionStorage, not
 * `returnTo`: the login URL's query would send the code to the server. An
 * entry older than an hour is ignored, so an abandoned link doesn't join the
 * tab's next login. */
function readPendingCode(groupId: string): string | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(pendingCodeKey(groupId)) ?? "null");
    if (typeof saved !== "object" || saved === null) return null;
    const { code, savedAt } = saved as { code?: unknown; savedAt?: unknown };
    if (typeof code !== "string" || typeof savedAt !== "number") return null;
    return Date.now() - savedAt < PENDING_CODE_TTL_MS ? code : null;
  } catch {
    return null;
  }
}

function writePendingCode(groupId: string, code: string | null) {
  try {
    if (code === null) sessionStorage.removeItem(pendingCodeKey(groupId));
    else sessionStorage.setItem(pendingCodeKey(groupId), JSON.stringify({ code, savedAt: Date.now() }));
  } catch {
    // Without storage the code just doesn't survive login.
  }
}

/** The access-code flow of a PRIVATE group's term page: the code sheet's
 * state, the `#code=` link (never sent to the server) and the join itself.
 * A link's code is acted on only once the current token's view is settled
 * (`view` is not `loading`): an anonymous visitor's is kept in sessionStorage
 * for after login, anyone else's is removed from the URL at once, and a
 * logged-in non-member's opens the sheet, auto-submitted when valid. A redeem
 * keeps the code in storage only if it gets a 401 (login redirect). */
export function useJoinCodeLink({
  groupId,
  view,
  isStale,
  joinWithCode,
  onJoined,
}: {
  groupId: string;
  view: TermViewState["kind"];
  isStale: boolean;
  joinWithCode: (code: string) => Promise<void>;
  onJoined: () => void;
}) {
  const pathname = useAppPathname();
  const search = useAppSearch();
  const hash = useAppHash();
  const navigate = useAppNavigate();
  const hashCode = new URLSearchParams(hash.slice(1)).get("code");
  // Once a redeem starts, the stored entry is `join`'s own (kept only
  // through a 401's login redirect), so it is no longer read here.
  const [redeemStarted, setRedeemStarted] = useState(false);
  const storedCode = useClientValue(() => (redeemStarted ? null : readPendingCode(groupId)), null);
  const pendingCode = hashCode ?? storedCode;
  const [sheet, setSheet] = useState<CodeSheet | null>(null);

  const settled = view !== "loading" && view !== "notFound" && view !== "error" && !isStale;

  // A link's code opens the sheet once the view is settled as `enterCode`
  // (set during render, so no extra effect pass).
  const linkCode = settled && view === "enterCode" ? pendingCode : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (linkCode !== openedFor) {
    setOpenedFor(linkCode);
    if (linkCode !== null) {
      const code = parseJoinCode(linkCode);
      setSheet(typeof code === "string" ? { initialCode: code, autoSubmit: true } : { initialCode: "", autoSubmit: false });
    }
  }

  useEffect(() => {
    if (!settled || pendingCode === null) return;
    if (view === "loginRequired") {
      writePendingCode(groupId, pendingCode);
      return;
    }
    // A valid code in the sheet is auto-submitted; `join` keeps or removes it.
    if (view !== "enterCode" || typeof parseJoinCode(pendingCode) !== "string") {
      writePendingCode(groupId, null);
    }
    if (hashCode !== null) navigate(pathname + search, { replace: true });
  }, [settled, view, pendingCode, hashCode, groupId, navigate, pathname, search]);

  const join = useCallback(
    async (code: string) => {
      // Saved before the redeem: on a 401 `api/client` redirects to login at
      // once, and the code must already be there for after it.
      writePendingCode(groupId, code);
      setRedeemStarted(true);
      try {
        await joinWithCode(code);
      } catch (err) {
        if (!(err instanceof Error && err.cause instanceof ApiError && err.cause.status === 401)) {
          writePendingCode(groupId, null);
        }
        throw err;
      }
      writePendingCode(groupId, null);
      setSheet(null);
      onJoined();
    },
    [groupId, joinWithCode, onJoined],
  );

  return {
    /** A shared `#code=` link was opened; the code is kept through login. */
    hasPendingCode: pendingCode !== null,
    /** The code sheet's props while it is open, `null` while closed. */
    sheet,
    openSheet: () => setSheet({ initialCode: "", autoSubmit: false }),
    closeSheet: () => setSheet(null),
    join,
  };
}
