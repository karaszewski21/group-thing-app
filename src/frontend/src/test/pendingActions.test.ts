import { describe, expect, it } from "vitest";
import type { NotificationResponse } from "../api/notifications";
import { derivePendingActions } from "../components/layout/pending/pendingActions";

const EVENT_ID = "22222222-2222-2222-2222-222222222222";

function notif(over: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    id: "1",
    kind: "TERM_CONFIRMATION_NEEDED",
    message: "Czy przekazanie „Rowerek” doszło do skutku? (śr 14.10, Kiermasz rzeczy)",
    link_path: `/ania/event/${EVENT_ID}`,
    read_at: null,
    created_at: "2026-10-14T18:00:00",
    reservation_id: "res-1",
    proposal_id: null,
    ...over,
  };
}

describe("derivePendingActions", () => {
  it("an event confirmation prompt has no term id and confirms via its reservation_id", () => {
    expect(derivePendingActions([notif({ proposal_id: "prop-1" })])).toEqual([
      {
        kind: "TERM_CONFIRMATION_NEEDED",
        notificationId: "1",
        message: notif().message,
        linkPath: `/ania/event/${EVENT_ID}`,
        termId: null,
        reservationId: "res-1",
        proposalId: "prop-1",
      },
    ]);
  });

  it("RESERVATION_CANCELLED yields no pending action", () => {
    expect(
      derivePendingActions([
        notif({ kind: "RESERVATION_CANCELLED", link_path: "/product/item-1", reservation_id: null }),
      ]),
    ).toEqual([]);
  });

  it.each([
    ["WANT_MATCH_FOUND", "Szukasz: «rowerek biegowy». Ktoś wystawił: «Rowerek biegowy Puky».", "/ania/product/item-1"],
    ["WANT_EXPIRING", "Poszukiwanie «fotelik» wygaśnie za 7 dni. Przedłuż je, jeśli nadal szukasz.", "/wanted/want-1"],
  ] as const)("%s yields no pending action", (kind, message, linkPath) => {
    expect(derivePendingActions([notif({ kind, message, link_path: linkPath, reservation_id: null })])).toEqual([]);
  });
});
