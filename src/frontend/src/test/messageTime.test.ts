import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatBubbleTime,
  formatDaySeparator,
  formatInboxTime,
  localDayKey,
} from "../pages/messages/messageTime";

// Audit timestamps arrive as naive UTC; the assertions are Warsaw wall-clock.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Warsaw";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

describe("messageTime", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Thursday 22.10.2026, 16:00 in Warsaw (CEST, UTC+2).
    vi.setSystemTime(new Date("2026-10-22T14:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formatBubbleTime_naiveUtc_rendersWarsawWallClock", () => {
    expect(formatBubbleTime("2026-10-22T10:00:00")).toBe("12:00");
    expect(formatBubbleTime("2026-10-22T10:00:00.123456")).toBe("12:00");
  });

  it("formatInboxTime_byAge_usesPinnedFormats", () => {
    expect(formatInboxTime("2026-10-22T08:30:00")).toBe("10:30");
    // 22:30 UTC on the 21st is already the 22nd in Warsaw.
    expect(formatInboxTime("2026-10-21T22:30:00")).toBe("00:30");
    expect(formatInboxTime("2026-10-21T10:00:00")).toBe("wczoraj");
    expect(formatInboxTime("2026-10-20T10:00:00")).toBe("wt");
    expect(formatInboxTime("2026-10-16T10:00:00")).toBe("pt");
    expect(formatInboxTime("2026-10-15T10:00:00")).toBe("15.10");
    expect(formatInboxTime("2025-12-31T10:00:00")).toBe("31.12.2025");
  });

  it("formatDaySeparator_byAge_usesPinnedFormats", () => {
    expect(formatDaySeparator("2026-10-22T10:00:00")).toBe("dzisiaj");
    expect(formatDaySeparator("2026-10-21T10:00:00")).toBe("wczoraj");
    expect(formatDaySeparator("2026-10-20T10:00:00")).toBe("wtorek, 20 października");
    expect(formatDaySeparator("2025-12-31T10:00:00")).toBe("środa, 31 grudnia 2025");
  });

  it("localDayKey_groupsByWarsawDay", () => {
    expect(localDayKey("2026-10-21T22:30:00")).toBe("2026-10-22");
    expect(localDayKey("2026-10-21T21:59:00")).toBe("2026-10-21");
  });
});
