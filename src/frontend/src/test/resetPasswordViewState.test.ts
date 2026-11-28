import { describe, expect, it } from "vitest";
import {
  resolveResetPasswordView,
  type ResetPasswordViewInput,
} from "../features/auth/resetPasswordViewState";

const EMAIL = "ania@example.pl";

const NO_TOKEN: ResetPasswordViewInput = {
  token: null,
  request: { status: "idle", email: "" },
  lookup: { loading: false, invalid: false, error: null, email: null },
  confirm: { status: "idle", password: "", repeat: "" },
};

const LOOKED_UP: ResetPasswordViewInput = {
  ...NO_TOKEN,
  token: "tok",
  lookup: { loading: false, invalid: false, error: null, email: EMAIL },
};

function withConfirm(confirm: Partial<ResetPasswordViewInput["confirm"]>, lookup?: Partial<ResetPasswordViewInput["lookup"]>) {
  return {
    ...LOOKED_UP,
    confirm: { ...LOOKED_UP.confirm, ...confirm },
    lookup: { ...LOOKED_UP.lookup, ...lookup },
  };
}

describe("resolveResetPasswordView", () => {
  it.each<[string, ResetPasswordViewInput, ReturnType<typeof resolveResetPasswordView>]>([
    ["no token: the request form", NO_TOKEN, { kind: "request", sending: false }],
    [
      "no token: sending",
      { ...NO_TOKEN, request: { status: "sending", email: EMAIL } },
      { kind: "request", sending: true },
    ],
    [
      "no token: always the neutral sent screen",
      { ...NO_TOKEN, request: { status: "sent", email: EMAIL } },
      { kind: "sent", email: EMAIL },
    ],
    [
      "no token: email is off (503)",
      { ...NO_TOKEN, request: { status: "unavailable", email: EMAIL } },
      { kind: "unavailable" },
    ],
    [
      "no token: the request failed",
      { ...NO_TOKEN, request: { status: "error", email: EMAIL } },
      { kind: "error", retry: "request", email: null },
    ],
    [
      "token: the lookup runs",
      { ...NO_TOKEN, token: "tok", lookup: { loading: true, invalid: false, error: null, email: null } },
      { kind: "loading" },
    ],
    [
      "token: lookup 404/410",
      { ...NO_TOKEN, token: "tok", lookup: { loading: false, invalid: true, error: null, email: null } },
      { kind: "invalid" },
    ],
    [
      "token: lookup network error",
      { ...NO_TOKEN, token: "tok", lookup: { loading: false, invalid: false, error: "boom", email: null } },
      { kind: "error", retry: "lookup", email: null },
    ],
    ["token: the empty form", LOOKED_UP, { kind: "form", email: EMAIL, saving: false, mismatch: false, canSave: false }],
    [
      "token: the passwords differ",
      withConfirm({ password: "sekret123", repeat: "sekret12" }),
      { kind: "form", email: EMAIL, saving: false, mismatch: true, canSave: false },
    ],
    [
      "token: the passwords match",
      withConfirm({ password: "sekret123", repeat: "sekret123" }),
      { kind: "form", email: EMAIL, saving: false, mismatch: false, canSave: true },
    ],
    [
      "token: saving",
      withConfirm({ status: "saving", password: "sekret123", repeat: "sekret123" }),
      { kind: "form", email: EMAIL, saving: true, mismatch: false, canSave: false },
    ],
    ["token: confirm 404/410", withConfirm({ status: "invalid" }), { kind: "invalid" }],
    ["token: confirm network error", withConfirm({ status: "error" }), { kind: "error", retry: "confirm", email: EMAIL }],
    ["token: confirm success", withConfirm({ status: "success" }), { kind: "success" }],
    [
      "token: confirm success, then lookup 410 → still success",
      withConfirm({ status: "success" }, { invalid: true, email: null }),
      { kind: "success" },
    ],
    [
      "token: confirm error wins over a lookup that turned invalid",
      withConfirm({ status: "error" }, { invalid: true, email: null }),
      { kind: "error", retry: "confirm", email: null },
    ],
  ])("%s", (_label, input, expected) => {
    expect(resolveResetPasswordView(input)).toEqual(expected);
  });
});
