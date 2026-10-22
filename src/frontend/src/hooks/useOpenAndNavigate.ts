import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { threadPath } from "../utils/messagesPaths";
import { useOpenConversation, type ChatTarget } from "./useOpenConversation";

interface UseOpenAndNavigateResult {
  open: (target: ChatTarget) => Promise<void>;
  /** True while a get-or-create request is in flight. */
  busy: boolean;
  /** Polish copy of the last failure, cleared when the next open starts. */
  error: string | null;
}

/** The chat entry points' click handler: opens (or creates) the conversation
 * and goes to its thread; a failure lands in `error` for an inline alert. */
export function useOpenAndNavigate(): UseOpenAndNavigateResult {
  const navigate = useNavigate();
  const { openConversation } = useOpenConversation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(target: ChatTarget) {
    setBusy(true);
    setError(null);
    try {
      navigate(threadPath(await openConversation(target)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return { open, busy, error };
}
