import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmEmailVerification, requestEmailVerification } from "../api/auth";
import { EMAIL_UNAVAILABLE_MESSAGE } from "../api/email";
import { hasStatus, serverMessageOr } from "../api/problem";
import { useOptionalPanelReload } from "../features/panel/appDataStore";
import { EMAIL_PREFERENCES_KEY } from "./useEmailPreferences";
import { MY_PROFILE_KEY } from "./useMyProfile";

const COOLDOWN_MS = 60_000;
const REQUEST_FALLBACK = "Nie udało się wysłać linku. Spróbuj ponownie.";

interface UseEmailVerificationRequestResult {
  /** Sends a new link; ignored while sending or during the cooldown. */
  request: () => Promise<void>;
  sending: boolean;
  /** A link went out in this view (stays true after the cooldown). */
  sent: boolean;
  /** Seconds until the next request is allowed, 0 when it is. */
  secondsLeft: number;
  error: string | null;
}

function secondsUntil(endsAt: number | null): number {
  return endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

/** Re-reads what shows the address state (profile and preferences) and then
 * the panel data, which is a no-op outside the panel. */
function useAfterVerificationChange(): () => Promise<void> {
  const queryClient = useQueryClient();
  const reloadPanel = useOptionalPanelReload();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [MY_PROFILE_KEY] }),
      queryClient.invalidateQueries({ queryKey: [EMAIL_PREFERENCES_KEY] }),
    ]);
    reloadPanel();
  }, [queryClient, reloadPanel]);
}

/** The "send a verification link" action with a 60 s local cooldown. Errors
 * land in `error` as Polish copy (503: email is off). */
export function useEmailVerificationRequest(): UseEmailVerificationRequestResult {
  const afterChange = useAfterVerificationChange();
  const [sending, setSending] = useState(false);
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const endsAt = useRef<number | null>(null);

  const secondsLeft = secondsUntil(cooldownEndsAt);

  useEffect(() => {
    if (secondsLeft === 0) return;
    const interval = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(interval);
  }, [secondsLeft]);

  const request = useCallback(async () => {
    if (busy.current || secondsUntil(endsAt.current) > 0) return;
    busy.current = true;
    setSending(true);
    setError(null);
    try {
      await requestEmailVerification();
      endsAt.current = Date.now() + COOLDOWN_MS;
      setCooldownEndsAt(endsAt.current);
      await afterChange();
    } catch (err) {
      setError(hasStatus(err, 503) ? EMAIL_UNAVAILABLE_MESSAGE : serverMessageOr(err, REQUEST_FALLBACK));
    } finally {
      busy.current = false;
      setSending(false);
    }
  }, [afterChange]);

  return { request, sending, sent: cooldownEndsAt !== null, secondsLeft, error };
}

/** Confirms a verification token, then re-reads the address state. Rejects
 * with the original error, so the page can tell 404/410 from a failure. */
export function useEmailVerificationConfirm(): (token: string) => Promise<void> {
  const afterChange = useAfterVerificationChange();
  return useCallback(
    async (token: string) => {
      await confirmEmailVerification(token);
      await afterChange();
    },
    [afterChange],
  );
}
