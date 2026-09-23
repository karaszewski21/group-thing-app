import { api } from "./client";

export type ReservationType = "LEND" | "RETURN" | "SWAP" | "GIFT";
export type ReservationStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "FULFILLED";

export interface ReservationResponse {
  id: number;
  item_id: number;
  reservation_type: ReservationType;
  reserved_by_user_id: number;
  // Optional here (not on the actual backend response, which always sets
  // it — see `circulation/schemas.py`'s `ReservationResponse.term_id`)
  // purely so pre-existing mocked `ReservationResponse` object literals in
  // `TermPage.test.tsx`/`PanelPage.test.tsx` (written before this
  // field existed on the frontend type) keep compiling without an
  // unrelated, out-of-scope rewrite. `RzeczyView.tsx`'s term-end
  // resolution (bug #4c) is the one real caller that reads it.
  term_id?: number;
  paired_reservation_id: number | null;
  reserved_at: string;
  expires_at: string | null;
  status: ReservationStatus;
  notes: string | null;
}

export interface CreateReservationRequest {
  item_id: number;
  reservation_type: ReservationType;
  reserved_by_user_id: number;
  expires_at?: string;
  notes?: string;
}

export interface CreateSwapRequest {
  first_item_id: number;
  first_reserved_by_user_id: number;
  second_item_id: number;
  second_reserved_by_user_id: number;
  expires_at?: string;
}

export function getReservations(itemId: number): Promise<ReservationResponse[]> {
  return api.get(`/reservations?item_id=${itemId}`);
}

export function getReservation(id: number): Promise<ReservationResponse> {
  return api.get(`/reservations/${id}`);
}

export function createReservation(request: CreateReservationRequest): Promise<ReservationResponse> {
  return api.post("/reservations", request);
}

export function createSwap(request: CreateSwapRequest): Promise<ReservationResponse[]> {
  return api.post("/reservations/swap", request);
}

export function confirmReservation(id: number): Promise<ReservationResponse> {
  return api.post(`/reservations/${id}/confirm`, undefined);
}

export function cancelReservation(id: number): Promise<ReservationResponse> {
  return api.post(`/reservations/${id}/cancel`, undefined);
}

export function fulfillReservation(id: number): Promise<ReservationResponse> {
  return api.post(`/reservations/${id}/fulfill`, undefined);
}

/** `term_id` is caller-supplied context (a bare `Reservation` carries no
 * Term reference) — used only to gate on `term.occurs_on`. */
export interface ConfirmTransactionRequest {
  term_id: number;
}

/** `already_resolved` is the explicit discriminator the global pending-
 * actions modal uses to render "the other party already resolved this"
 * distinctly from a generic error — it is only ever `true` when this
 * response accompanies a 409 (see `api/client.ts`'s `ApiError`, whose
 * `body` carries this same shape on that status). */
export interface ConfirmTransactionResponse {
  reservation_id: number;
  status: string;
  already_resolved: boolean;
}

export function confirmTransaction(
  reservationId: number,
  request: ConfirmTransactionRequest,
): Promise<ConfirmTransactionResponse> {
  return api.post(`/reservations/${reservationId}/confirm-transaction`, request);
}

/** Mirrors `ConfirmTransactionRequest`/`ConfirmTransactionResponse` exactly
 * — same `term_id`-gated shared gating helper backend-side
 * (`_resolve_transaction_reservations_for_action`), same
 * `already_resolved`-discriminated 409 race-loss shape. */
export type CancelTransactionRequest = ConfirmTransactionRequest;
export type CancelTransactionResponse = ConfirmTransactionResponse;

export function cancelTransaction(
  reservationId: number,
  request: CancelTransactionRequest,
): Promise<CancelTransactionResponse> {
  return api.post(`/reservations/${reservationId}/cancel-transaction`, request);
}
