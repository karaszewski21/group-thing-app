import { describe, expect, it } from "vitest";
import { resolveTermAccess } from "../pages/krag/termAccess";
import type { GroupAccessDetails, GroupAccessResponse, PublicCircleResponse } from "../api/groups";

const group: PublicCircleResponse = {
  id: 7,
  name: "Muzyczne Skrzaty",
  organizer_display_name: "Ania Kowalska",
  organizer_slug: "ania",
  visibility: "PRIVATE",
  layout_mode: "CIRCLE",
  term: null,
  guardians: [],
};

function data(access: Partial<GroupAccessDetails>, visibility: "PUBLIC" | "PRIVATE" = "PRIVATE"): GroupAccessResponse {
  return {
    group: { ...group, visibility },
    access: {
      is_member: false,
      is_organizer: false,
      can_view_content: false,
      is_attending: false,
      join_request: null,
      ...access,
    },
  };
}

describe("resolveTermAccess", () => {
  it.each([
    ["PUBLIC group", data({ can_view_content: true }, "PUBLIC"), false, { kind: "view", isAttending: false }],
    ["PRIVATE member", data({ is_member: true, can_view_content: true, is_attending: true }), true, { kind: "view", isAttending: true }],
    ["PRIVATE organizer", data({ is_organizer: true, can_view_content: true }), true, { kind: "view", isAttending: false }],
    ["anonymous", data({}), false, { kind: "gate", gate: { kind: "loginRequired" } }],
    ["logged in, no request", data({}), true, { kind: "gate", gate: { kind: "canRequest" } }],
    [
      "PENDING request",
      data({ join_request: { id: 5, status: "PENDING" } }),
      true,
      { kind: "gate", gate: { kind: "pending", requestId: 5 } },
    ],
    ["REJECTED request", data({ join_request: { id: 5, status: "REJECTED" } }), true, { kind: "gate", gate: { kind: "rejected" } }],
    [
      "PENDING in data fetched without a token",
      data({ join_request: { id: 5, status: "PENDING" } }),
      false,
      { kind: "gate", gate: { kind: "loginRequired" } },
    ],
  ])("%s", (_label, input, identified, expected) => {
    expect(resolveTermAccess(input, identified)).toMatchObject(expected);
  });
});
