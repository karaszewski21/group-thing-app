import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { getMyReservations, type MyReservationResponse } from "../api/reservations";
import { extractProblemMessage } from "../api/problem";
import { useAuth } from "../auth/AuthContext";

interface UseMyReservationsResult {
  data: MyReservationResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const MY_RESERVATIONS_KEY = "myReservations";
const NO_RESERVATIONS: MyReservationResponse[] = [];

/** "Zarezerwowane": the items the caller is about to receive, listed under
 * Konto → Moje rzeczy. The token is part of the key, so another account's
 * reservations never show. */
export function useMyReservations(): UseMyReservationsResult {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: [MY_RESERVATIONS_KEY, token],
    queryFn: getMyReservations,
    enabled: token !== null,
  });
  const { refetch: queryRefetch } = query;

  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);

  return {
    data: query.data ?? NO_RESERVATIONS,
    loading: query.isPending && token !== null,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
