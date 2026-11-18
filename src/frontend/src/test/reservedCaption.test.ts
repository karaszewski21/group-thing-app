import { describe, expect, it } from "vitest";
import { reservedCaption } from "../features/wanted/reservedCaption";
import { makeWantSimilar } from "./fixtures/wants";

const RESERVED = { mode: "GIFT", condition: "GOOD", thumb_url: null, reserved: true, reserved_until: null } as const;

describe("reservedCaption", () => {
  it.each([
    ["reserved by me", makeWantSimilar({ meta: RESERVED, reserved_by_me: true, proposed_by_me: true }), "Zarezerwowane przez Ciebie"],
    ["proposed by me", makeWantSimilar({ proposed_by_me: true }), "Twoja propozycja"],
    ["reserved by someone else", makeWantSimilar({ meta: RESERVED }), "Zarezerwowane"],
    ["free", makeWantSimilar(), undefined],
  ])("%s", (_, item, expected) => {
    expect(reservedCaption(item)).toBe(expected);
  });
});
