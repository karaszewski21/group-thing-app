import { api } from "./client";

export type ReservationType = "LEND" | "RETURN" | "SWAP" | "GIFT";
export type ReservationStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "FULFILLED";

export interface ReservationResponse {
  id: number;
  item_id: number;
  reservation_type: ReservationType;
  reserved_by_user_id: number;
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
