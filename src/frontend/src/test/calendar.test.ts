import { describe, expect, it, vi } from "vitest";
import {
  buildGoogleCalendarUrl,
  buildIcs,
  calendarFilename,
  calendarUid,
  downloadIcs,
  type CalendarEvent,
} from "../utils/calendar";

const NOW = new Date(Date.UTC(2026, 9, 13, 8, 5, 9));

const EVENT: CalendarEvent = {
  uid: calendarUid("term-1", "item-9"),
  title: "Odbiór: Pucio",
  occursOn: "2026-10-15T16:30:00",
  groupName: "Krąg Mokotów",
  url: "https://krag.example/krag/g1/t1",
};

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Warsaw",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });

const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("calendar export", () => {
  it("builds a Google Calendar template URL with Warsaw-local 1 h dates", () => {
    const url = buildGoogleCalendarUrl(EVENT);
    expect(url.startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE&")).toBe(true);
    expect(url).toContain("dates=20261015T163000/20261015T173000");
    expect(url).toContain("ctz=Europe/Warsaw");
    expect(url).toContain(`text=${encodeURIComponent("Odbiór: Pucio")}`);
    expect(url).toContain(`location=${encodeURIComponent("Krąg Mokotów")}`);
    expect(url).toContain(`details=${encodeURIComponent("Krąg Mokotów\nhttps://krag.example/krag/g1/t1")}`);
  });

  it("builds a CRLF VCALENDAR with the exact Warsaw VTIMEZONE, two alarms and a stable UID", () => {
    const ics = buildIcs(EVENT, NOW);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain(VTIMEZONE);

    const lines = unfold(ics).split("\r\n");
    expect(lines).toContain("UID:term-1-item-9@krag-grupy");
    expect(lines).toContain("DTSTAMP:20261013T080509Z");
    expect(lines).toContain("DTSTART;TZID=Europe/Warsaw:20261015T163000");
    expect(lines).toContain("DTEND;TZID=Europe/Warsaw:20261015T173000");
    expect(lines).toContain("SUMMARY:Odbiór: Pucio");
    expect(lines).toContain("LOCATION:Krąg Mokotów");
    expect(lines).toContain("DESCRIPTION:Krąg Mokotów\\nhttps://krag.example/krag/g1/t1");

    const alarms = unfold(ics).split("BEGIN:VALARM").slice(1);
    expect(alarms).toHaveLength(2);
    expect(alarms[0]).toContain("TRIGGER:-P1D");
    expect(alarms[1]).toContain("TRIGGER:-PT2H");
    for (const alarm of alarms) {
      expect(alarm).toContain("ACTION:DISPLAY");
      expect(alarm).toContain("DESCRIPTION:Odbiór: Pucio");
    }
    expect(buildIcs(EVENT, NOW)).toBe(ics);
  });

  it("escapes backslash, semicolon, comma and newline per RFC 5545", () => {
    const ics = unfold(buildIcs({ ...EVENT, title: "A\\B; C, D\nE" }, NOW));
    expect(ics).toContain("SUMMARY:A\\\\B\\; C\\, D\\nE");
  });

  it("folds at 75 UTF-8 bytes without splitting Polish multi-byte characters", () => {
    const longName = "Zażółć gęślą jaźń ąśż ".repeat(8).trim();
    const ics = buildIcs({ ...EVENT, groupName: longName }, NOW);
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
      expect(line).not.toContain("�");
    }
    expect(unfold(ics)).toContain(`LOCATION:${longName}`);
  });

  it("rolls a 23:30 start over to 00:30 the next day, independent of the machine TZ", () => {
    const late = { ...EVENT, occursOn: "2026-10-31T23:30:00" };
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const newYork = buildIcs(late, NOW) + buildGoogleCalendarUrl(late);
      process.env.TZ = "Europe/Warsaw";
      const warsaw = buildIcs(late, NOW) + buildGoogleCalendarUrl(late);
      expect(newYork).toBe(warsaw);
    } finally {
      process.env.TZ = originalTz;
    }
    expect(buildIcs(late, NOW)).toContain("DTEND;TZID=Europe/Warsaw:20261101T003000");
    expect(buildGoogleCalendarUrl(late)).toContain("dates=20261031T233000/20261101T003000");
  });

  it("downloads a text/calendar Blob under an ASCII slug filename and revokes the URL only after a delay", async () => {
    expect(calendarFilename("Odbiór: Pucio", "2026-10-15T16:30:00")).toBe("odbior-pucio-15-10.ics");
    expect(calendarFilename("Zamiana: Łódka ↔ Żaba", "2026-01-05T09:00:00")).toBe("zamiana-lodka-zaba-05-01.ics");

    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:ics");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("odbior-pucio-15-10.ics");
      expect(this.getAttribute("href")).toBe("blob:ics");
      expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      downloadIcs(EVENT, NOW);
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:ics");
    } finally {
      vi.useRealTimers();
    }

    expect(click).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/calendar;charset=utf-8");
    expect(await readBlob(blob)).toBe(buildIcs(EVENT, NOW));
    click.mockRestore();
  });
});

describe("calendar export on DST change days", () => {
  it.each([
    ["2026-03-29T01:30:00", "20260329T013000", "20260329T023000"],
    ["2026-10-25T02:30:00.123456", "20261025T023000", "20261025T033000"],
  ])("keeps %s as a Warsaw wall-clock 1 h slot (fractional seconds ignored)", (occursOn, start, end) => {
    const event = { ...EVENT, occursOn };
    const lines = unfold(buildIcs(event, NOW)).split("\r\n");
    expect(lines).toContain(`DTSTART;TZID=Europe/Warsaw:${start}`);
    expect(lines).toContain(`DTEND;TZID=Europe/Warsaw:${end}`);
    expect(buildGoogleCalendarUrl(event)).toContain(`dates=${start}/${end}`);
  });
});
