import type { GroupAccessResponse, PublicCircleResponse } from "../../api/groups";

/** What a visitor who can't see a PRIVATE group's content is offered. */
export type PrivateGate =
  | { kind: "loginRequired" }
  | { kind: "canRequest" }
  | { kind: "pending"; requestId: number }
  | { kind: "rejected" };

export type TermAccess =
  | { kind: "view"; group: PublicCircleResponse; isAttending: boolean }
  | { kind: "gate"; group: PublicCircleResponse; gate: PrivateGate };

/** Derives what the term page shows from the `/access` response.
 * `identified` means the data was fetched with a token — not that a token
 * exists now — so data fetched anonymously never offers a request. */
export function resolveTermAccess(data: GroupAccessResponse, identified: boolean): TermAccess {
  const { group, access } = data;
  if (access.can_view_content) return { kind: "view", group, isAttending: access.is_attending };
  if (!identified) return { kind: "gate", group, gate: { kind: "loginRequired" } };
  const request = access.join_request;
  if (request?.status === "PENDING") return { kind: "gate", group, gate: { kind: "pending", requestId: request.id } };
  if (request?.status === "REJECTED") return { kind: "gate", group, gate: { kind: "rejected" } };
  return { kind: "gate", group, gate: { kind: "canRequest" } };
}
