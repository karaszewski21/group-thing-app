import { describe, expect, it } from "vitest";
import {
  resolveVerifyEmailView,
  type VerifyEmailInput,
  type VerifyEmailView,
} from "../features/email/verifyEmailViewState";

const EMAIL = "ania@example.pl";

const lookupLoading: VerifyEmailInput["lookup"] = { email: null, loading: true, invalid: false, error: null };
const lookupReady: VerifyEmailInput["lookup"] = { email: EMAIL, loading: false, invalid: false, error: null };
const lookupInvalid: VerifyEmailInput["lookup"] = { email: null, loading: false, invalid: true, error: null };
const lookupFailed: VerifyEmailInput["lookup"] = { email: null, loading: false, invalid: false, error: "boom" };
const lookupIdle: VerifyEmailInput["lookup"] = { email: null, loading: false, invalid: false, error: null };

describe("resolveVerifyEmailView", () => {
  it.each<[string, VerifyEmailInput, VerifyEmailView]>([
    ["missing token", { hasToken: false, lookup: lookupIdle, confirm: "idle" }, { kind: "invalid" }],
    ["lookup loading", { hasToken: true, lookup: lookupLoading, confirm: "idle" }, { kind: "loading" }],
    ["lookup failed", { hasToken: true, lookup: lookupFailed, confirm: "idle" }, { kind: "error", retry: "lookup" }],
    ["lookup 404/410", { hasToken: true, lookup: lookupInvalid, confirm: "idle" }, { kind: "invalid" }],
    [
      "ready to confirm",
      { hasToken: true, lookup: lookupReady, confirm: "idle" },
      { kind: "confirm", email: EMAIL, confirming: false },
    ],
    [
      "confirming",
      { hasToken: true, lookup: lookupReady, confirm: "pending" },
      { kind: "confirm", email: EMAIL, confirming: true },
    ],
    ["confirm 404/410", { hasToken: true, lookup: lookupReady, confirm: "invalid" }, { kind: "invalid" }],
    ["confirm failed", { hasToken: true, lookup: lookupReady, confirm: "error" }, { kind: "error", retry: "confirm" }],
    ["success", { hasToken: true, lookup: lookupReady, confirm: "success" }, { kind: "success" }],
    ["success, then lookup 410 → success", { hasToken: true, lookup: lookupInvalid, confirm: "success" }, { kind: "success" }],
    ["success, then lookup refresh error → success", { hasToken: true, lookup: lookupFailed, confirm: "success" }, { kind: "success" }],
    [
      "confirm error wins over a stale lookup",
      { hasToken: true, lookup: lookupLoading, confirm: "error" },
      { kind: "error", retry: "confirm" },
    ],
  ])("%s", (_name, input, expected) => {
    expect(resolveVerifyEmailView(input)).toEqual(expected);
  });
});
