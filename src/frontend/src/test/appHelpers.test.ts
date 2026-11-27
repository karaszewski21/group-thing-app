import { describe, expect, it } from "vitest";
import {
  clampPointsPrice,
  ITEM_MODE_STYLE,
  ITEM_MODE_TO_RESERVATION_TYPE,
  ITEM_MODE_TONE,
  ITEM_MODES,
  parsePointsPrice,
  pointsPriceError,
  RESERVATION_TYPE_TO_ITEM_MODE,
  type PointsPriceBounds,
} from "../utils/appHelpers";

const BOUNDS: PointsPriceBounds = { min: 20, max: 60, step: 10 };

describe("parsePointsPrice", () => {
  it.each<[string, number | null | undefined]>([
    ["", null],
    ["   ", null],
    ["40", 40],
    [" 40 ", 40],
    ["20", 20],
    ["60", 60],
    ["4a", undefined],
    ["-40", undefined],
    ["40.0", undefined],
    ["1e2", undefined],
    ["10", undefined],
    ["70", undefined],
    ["45", undefined],
  ])("%j → %s", (raw, expected) => {
    expect(parsePointsPrice(raw, BOUNDS)).toBe(expected);
  });

  it("words the bounds error as the server does", () => {
    expect(pointsPriceError(BOUNDS)).toBe("Cena musi być od 20 do 60 pkt, co 10.");
  });
});

describe("clampPointsPrice", () => {
  it.each<[number, PointsPriceBounds, number]>([
    [40, BOUNDS, 40],
    [44, BOUNDS, 40],
    [45, BOUNDS, 50],
    [10, BOUNDS, 20],
    [14, BOUNDS, 20],
    [70, BOUNDS, 60],
    [65, BOUNDS, 60],
    [60, { min: 25, max: 50, step: 25 }, 50],
    [37, { min: 25, max: 50, step: 25 }, 25],
    [38, { min: 25, max: 50, step: 25 }, 50],
    [40, { min: 10, max: 30, step: 10 }, 30],
  ])("%j within %j → %j", (price, bounds, expected) => {
    expect(clampPointsPrice(price, bounds)).toBe(expected);
  });
});

describe("item modes", () => {
  it("lists „za punkty” last, mapped both ways to POINTS", () => {
    expect(ITEM_MODES).toEqual(["oddam", "zamienię", "za punkty"]);
    expect(ITEM_MODE_TO_RESERVATION_TYPE["za punkty"]).toBe("POINTS");
    expect(RESERVATION_TYPE_TO_ITEM_MODE.POINTS).toBe("za punkty");
  });

  it("gives „za punkty” the orange tone with ink text", () => {
    expect(ITEM_MODE_TONE["za punkty"]).toBe("bg-orange text-ink");
    expect(ITEM_MODE_STYLE["za punkty"]).toEqual({ bg: "var(--color-orange)", c: "var(--color-ink)" });
  });
});
