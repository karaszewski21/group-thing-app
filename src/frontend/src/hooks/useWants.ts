import { useQuery, useQueryClient, type QueryKey, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { extractProblemMessage } from "../api/problem";
import type { WantCloseOutcome, WantCreateRequest, WantResponse, WantUpdateRequest } from "../api/wants";
import { closeWant, createWant, extendWant, getMyWants, resumeWant, updateWant } from "../api/wants";
import { useAuth } from "../auth/AuthContext";

interface UseWantsResult {
  data: WantResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (request: WantCreateRequest) => Promise<WantResponse>;
  update: (id: string, request: WantUpdateRequest) => Promise<WantResponse>;
  extend: (id: string) => Promise<WantResponse>;
  close: (id: string, outcome: WantCloseOutcome) => Promise<WantResponse>;
  resume: (id: string) => Promise<WantResponse>;
}

export const WANTS_KEY = "wants";
const NO_WANTS: WantResponse[] = [];

/** While the matcher has yet to answer a want, its queries re-read this often… */
export const MATCHING_POLL_MS = 2_000;
/** …for at most this long after the hook first sees it matching. */
export const MATCHING_WINDOW_MS = 60_000;

interface MatchingPolledQueryOptions<T> {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  enabled: boolean;
  /** Whether the loaded data still waits for the matcher. */
  isMatching: (data: T) => boolean;
}

interface MatchingPolledQuery<T> {
  query: UseQueryResult<T>;
  /** The window ran out while the data still waits for the matcher. */
  slow: boolean;
  /** Opens a new window, so polling resumes while still matching. */
  restart: () => void;
}

/** A query that polls every 2 s while its data is matching, for one 60 s
 * window. The window opens when the hook first sees matching data (again
 * after matching stopped and started, and on `restart`). Its end is one
 * `setTimeout` setting `expired`, so `slow` re-renders even when no data
 * changes. Polling pauses in a background tab (TanStack default). */
export function useMatchingPolledQuery<T>({
  isMatching,
  ...options
}: MatchingPolledQueryOptions<T>): MatchingPolledQuery<T> {
  const [expired, setExpired] = useState(false);
  const [round, setRound] = useState(0);
  const query = useQuery({
    ...options,
    refetchInterval: (q) =>
      q.state.data !== undefined && isMatching(q.state.data) && !expired ? MATCHING_POLL_MS : false,
  });
  const matching = query.data !== undefined && isMatching(query.data);

  const [wasMatching, setWasMatching] = useState(matching);
  if (wasMatching !== matching) {
    setWasMatching(matching);
    if (matching) setExpired(false);
  }

  useEffect(() => {
    if (!matching || expired) return;
    const timer = setTimeout(() => setExpired(true), MATCHING_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [matching, expired, round]);

  const restart = useCallback(() => {
    setExpired(false);
    setRound((n) => n + 1);
  }, []);

  return { query, slow: matching && expired, restart };
}

function anyMatching(wants: WantResponse[]): boolean {
  return wants.some((want) => want.matching);
}

export const WANT_NETWORK_ERROR_MESSAGE = "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.";

/** A failed write: the server's message verbatim plus its HTTP status
 * (`null` without a response, then with a Polish connection message), so a
 * caller can tell e.g. the 409 cap apart. */
export class WantWriteError extends Error {
  readonly status: number | null;

  constructor(err: unknown) {
    const status = err instanceof ApiError ? err.status : null;
    super(status === null ? WANT_NETWORK_ERROR_MESSAGE : extractProblemMessage(err));
    this.name = "WantWriteError";
    this.status = status;
  }
}

async function passingMessageThrough<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw new WantWriteError(err);
  }
}

/** The caller's own wants (active, expired, fulfilled). The token is part of
 * the key: another account's wants must never show, even briefly. Writes
 * refresh every wants query, the match lists included. While any want is
 * matching the list polls for one window; after it a card keeps „Szukamy…”
 * until the next focus or mount refetch. */
export function useWants(): UseWantsResult {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { query } = useMatchingPolledQuery({
    queryKey: [WANTS_KEY, "mine", token],
    queryFn: () => getMyWants(),
    enabled: token !== null,
    isMatching: anyMatching,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  const write = useCallback(
    async (call: () => Promise<WantResponse>, goneId?: string) => {
      const want = await passingMessageThrough(call);
      await queryClient.invalidateQueries(
        goneId === undefined
          ? { queryKey: [WANTS_KEY] }
          : // A withdrawn want's own page is on its way out; refetching it would only 404.
            { queryKey: [WANTS_KEY], predicate: ({ queryKey }) => !(queryKey[1] === "matches" && queryKey[3] === goneId) },
      );
      return want;
    },
    [queryClient],
  );

  const create = useCallback((request: WantCreateRequest) => write(() => createWant(request)), [write]);
  const update = useCallback(
    (id: string, request: WantUpdateRequest) => write(() => updateWant(id, request)),
    [write],
  );
  const extend = useCallback((id: string) => write(() => extendWant(id)), [write]);
  const close = useCallback(
    (id: string, outcome: WantCloseOutcome) =>
      write(() => closeWant(id, outcome), outcome === "WITHDRAWN" ? id : undefined),
    [write],
  );
  const resume = useCallback((id: string) => write(() => resumeWant(id)), [write]);

  return {
    data: query.data ?? NO_WANTS,
    loading: query.isPending && token !== null,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
    create,
    update,
    extend,
    close,
    resume,
  };
}
