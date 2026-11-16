import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
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
 * refresh every wants query, the match lists included. */
export function useWants(): UseWantsResult {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [WANTS_KEY, "mine", token],
    queryFn: () => getMyWants(),
    enabled: token !== null,
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
