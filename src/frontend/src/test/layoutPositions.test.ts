import { describe, expect, it } from "vitest";
import {
  getCirclePosition,
  getPitchPosition,
  getTablePosition,
  getStableSlotOrder,
} from "../utils/layoutPositions";

/** Legacy `pos()` math from `TermPage.tsx` (pre-refactor), kept here only to
 * assert `getCirclePosition` is a 1:1 port. */
function legacyPos(i: number, slots: number) {
  const R = 38;
  const a = (i / slots) * 2 * Math.PI - Math.PI / 2;
  return { left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%` };
}

function assertNoOverlaps(positions: { x: number; y: number }[]) {
  const seen = new Set<string>();
  for (const p of positions) {
    const key = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }
}

describe("layoutPositions", () => {
  it("getCirclePosition matches the legacy pos() formula for known (index, total) pairs", () => {
    const cases: Array<[number, number]> = [
      [0, 6],
      [3, 6],
      [5, 6],
      [0, 1],
      [7, 12],
    ];
    for (const [i, slots] of cases) {
      const legacy = legacyPos(i, slots);
      const result = getCirclePosition(i, slots);
      expect(`${result.x}%`).toBe(legacy.left);
      expect(`${result.y}%`).toBe(legacy.top);
    }
  });

  it.each([1, 5, 30])("getCirclePosition produces no overlapping positions for N=%i", (n: number) => {
    const total = n + 1; // families + invite slot, matching TermPage's `slots`
    const positions = Array.from({ length: total }, (_, i) => getCirclePosition(i, total));
    assertNoOverlaps(positions);
  });

  it.each([1, 5, 30])("getPitchPosition produces no overlapping positions for N=%i", (n: number) => {
    const positions = Array.from({ length: n }, (_, i) => getPitchPosition(i, n));
    assertNoOverlaps(positions);
  });

  it.each([1, 5, 30])("getTablePosition produces no overlapping positions for N=%i", (n: number) => {
    const positions = Array.from({ length: n }, (_, i) => getTablePosition(i, n));
    assertNoOverlaps(positions);
  });

  it("getStableSlotOrder is deterministic for the same groupId + familyIds pair", () => {
    const familyIds = [101, 102, 103, 104, 105];
    const first = getStableSlotOrder(42, familyIds);
    const second = getStableSlotOrder(42, [...familyIds]);
    expect(second).toEqual(first);
  });

  it("getStableSlotOrder differs across different groupIds for the same familyIds", () => {
    const familyIds = [101, 102, 103, 104, 105];
    const orderA = getStableSlotOrder(1, familyIds);
    const orderB = getStableSlotOrder(2, familyIds);
    expect(orderB).not.toEqual(orderA);
  });
});
