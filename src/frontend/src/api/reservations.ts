import { api } from "./client";

export type ReservationType = "LEND" | "RETURN" | "SWAP" | "GIFT";
export type ReservationStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "FULFILLED";

export interface ReservationResponse {
  id: string;
  item_id: string;
  reservation_type: ReservationType;
  reserved_by_user_id: string;
  // Optional here (not on the actual backend response, which always sets
  // it — see `circulation/schemas.py`'s `ReservationResponse.term_id`)
  // purely so pre-existing mocked `ReservationResponse` object literals in
  // `TermPage.test.tsx`/`PanelPage.test.tsx` (written before this
  // field existed on the frontend type) keep compiling without an
  // unrelated, out-of-scope rewrite. `RzeczyView.tsx`'s term-end
  // resolution (bug #4c) is the one real caller that reads it.
  term_id?: string;
  paired_reservation_id: string | null;
  reserved_at: string;
  expires_at: string | null;
  status: ReservationStatus;
  notes: string | null;
}

/** The raw `POST /reservations` route only creates RETURNs; the server
 * derives the recipient (the item's home owner) from the item itself. */
export interface CreateReturnReservationRequest {
  item_id: string;
  reservation_type?: "RETURN";
  notes?: string | null;
}

export function getReservations(itemId: string): Promise<ReservationResponse[]> {
  return api.get(`/reservations?item_id=${itemId}`);
}

export function getReservation(id: string): Promise<ReservationResponse> {
  return api.get(`/reservations/${id}`);
}

export function createReservation(
  request: CreateReturnReservationRequest,
): Promise<ReservationResponse> {
  return api.post("/reservations", request);
}

export function confirmReservation(id: string): Promise<ReservationResponse> {
  return api.post(`/reservations/${id}/confirm`, undefined);
}

export function fulfillReservation(id: string): Promise<ReservationResponse> {
  return api.post(`/reservations/${id}/fulfill`, undefined);
}

/** `already_resolved` is the explicit discriminator the global pending-
 * actions modal uses to render "the other party already resolved this"
 * distinctly from a generic error — it is only ever `true` when this
 * response accompanies a 409 (see `api/client.ts`'s `ApiError`, whose
 * `body` carries this same shape on that status). */
export interface ConfirmTransactionResponse {
  reservation_id: string;
  status: string;
  already_resolved: boolean;
}

/** The backend gates on the reservation's own Term (`reservation.term_id`
 * → `term.occurs_on`), so no request body is sent. */
export function confirmTransaction(reservationId: string): Promise<ConfirmTransactionResponse> {
  return api.post(`/reservations/${reservationId}/confirm-transaction`, undefined);
}

/** Mirrors `confirmTransaction` exactly — same shared gating helper
 * backend-side (`_resolve_transaction_reservations_for_action`), same
 * `already_resolved`-discriminated 409 race-loss shape. */
export type CancelTransactionResponse = ConfirmTransactionResponse;

export function cancelTransaction(reservationId: string): Promise<CancelTransactionResponse> {
  return api.post(`/reservations/${reservationId}/cancel-transaction`, undefined);
}
