import { describe, expect, it } from "vitest";
import { resolveTermView } from "../pages/term/termViewState";
import type { GroupAccessDetails, PublicCircleResponse } from "../api/groups";
import type { TermAccessState } from "../hooks/useTermAccess";

const group: PublicCircleResponse = {
  id: "7",
  name: "Muzyczne Skrzaty",
  organizer_display_name: "Ania Kowalska",
  organizer_slug: "ania",
  visibility: "PRIVATE",
  layout_mode: "CIRCLE",
  organization: null,
  term: null,
  guardians: [],
};

function ready(
  access: Partial<GroupAccessDetails>,
  {
    forToken = "t",
    refreshError = null,
    visibility = "PRIVATE",
  }: { forToken?: string | null; refreshError?: string | null; visibility?: "PUBLIC" | "PRIVATE" } = {},
): TermAccessState {
  return {
    status: "ready",
    forToken,
    refreshError,
    data: {
      group: { ...group, visibility },
      access: { is_member: false, is_organizer: false, can_view_content: false, is_attending: false, ...access },
    },
  };
}

describe("resolveTermView", () => {
  it.each([
    ["first load", { status: "loading" } as TermAccessState, false, { kind: "loading" }],
    ["404", { status: "error", message: "x" } as TermAccessState, false, { kind: "notFound" }],
    ["PUBLIC group, anonymous", ready({ can_view_content: true }, { forToken: null, visibility: "PUBLIC" }), false, { kind: "content", isAttending: false }],
    ["PRIVATE member", ready({ is_member: true, can_view_content: true, is_attending: true }), false, { kind: "content", isAttending: true }],
    ["PRIVATE organizer", ready({ is_organizer: true, can_view_content: true }), false, { kind: "content" }],
    ["content stays shown while stale", ready({ can_view_content: true }), true, { kind: "content" }],
    ["anonymous", ready({}, { forToken: null }), false, { kind: "loginRequired", refreshError: null }],
    ["logged-in non-member", ready({}), false, { kind: "enterCode", refreshError: null }],
    ["refresh failed after a token change", ready({}, { refreshError: "boom" }), true, { kind: "refreshFailed" }],
    ["gate from another token, new answer pending", ready({}), true, { kind: "loading" }],
    ["same token, refetch failed", ready({}, { refreshError: "boom" }), false, { kind: "enterCode", refreshError: "boom" }],
  ])("%s", (_label, state, isStale, expected) => {
    expect(resolveTermView(state, isStale)).toMatchObject(expected);
  });
});
