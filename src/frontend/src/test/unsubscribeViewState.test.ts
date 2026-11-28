import { describe, expect, it } from "vitest";
import { resolveUnsubscribeView, type UnsubscribeSubmitState } from "../features/email/unsubscribeViewState";
import { parseUnsubscribeCategory } from "../features/email/unsubscribeToken";

const PARTY = "0b6f3c2e-8a51-4d1e-9a43-6b3f0f1c2d4e";

describe("parseUnsubscribeCategory", () => {
  it.each([
    [`1.RESERVATIONS.${PARTY}.c2lnbmF0dXJl`, "RESERVATIONS"],
    [`1.WANTS.${PARTY}.c2lnbmF0dXJl`, "WANTS"],
    [`1.ALL.${PARTY}.c2lnbmF0dXJl`, null],
    [`1.ACCOUNT.${PARTY}.c2lnbmF0dXJl`, null],
    [`2.WANTS.${PARTY}.c2lnbmF0dXJl`, null],
    [`1.WANTS.${PARTY}`, null],
    [`1.WANTS.${PARTY}.sig.extra`, null],
    [`1.WANTS..c2lnbmF0dXJl`, null],
    ["garbage", null],
    ["", null],
    [null, null],
  ])("%s → %s", (token, expected) => {
    expect(parseUnsubscribeCategory(token)).toBe(expected);
  });
});

describe("resolveUnsubscribeView", () => {
  const idle: UnsubscribeSubmitState = { status: "idle" };

  it.each<[string, Parameters<typeof resolveUnsubscribeView>[0], ReturnType<typeof resolveUnsubscribeView>]>([
    ["unparseable token", { category: null, submit: idle }, { kind: "invalid" }],
    [
      "unparseable token ignores a later submit",
      { category: null, submit: { status: "done", category: "WANTS", scope: "all" } },
      { kind: "invalid" },
    ],
    ["fresh choice", { category: "WANTS", submit: idle }, { kind: "choice", category: "WANTS", pending: null, failed: false }],
    [
      "saving one scope",
      { category: "WANTS", submit: { status: "pending", scope: "all" } },
      { kind: "choice", category: "WANTS", pending: "all", failed: false },
    ],
    [
      "a failed save keeps the choice",
      { category: "RESERVATIONS", submit: { status: "error" } },
      { kind: "choice", category: "RESERVATIONS", pending: null, failed: true },
    ],
    [
      "a retry after a failure clears the alert",
      { category: "RESERVATIONS", submit: { status: "pending", scope: "category" } },
      { kind: "choice", category: "RESERVATIONS", pending: "category", failed: false },
    ],
    ["a 404 from the POST", { category: "WANTS", submit: { status: "invalid" } }, { kind: "invalid" }],
    [
      "done for the category",
      { category: "WANTS", submit: { status: "done", category: "WANTS", scope: "category" } },
      { kind: "done", category: "WANTS", scope: "category" },
    ],
    [
      "done for everything",
      { category: "RESERVATIONS", submit: { status: "done", category: "RESERVATIONS", scope: "all" } },
      { kind: "done", category: "RESERVATIONS", scope: "all" },
    ],
  ])("%s", (_name, input, expected) => {
    expect(resolveUnsubscribeView(input)).toEqual(expected);
  });
});
