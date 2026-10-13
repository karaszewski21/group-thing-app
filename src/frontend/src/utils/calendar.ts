/** Calendar export for a Term hand-over: a Google Calendar template link and
 * an RFC 5545 `.ics` file. Times come straight from the naive Warsaw
 * `occursOn` string and never round-trip through a browser-local `Date`, so
 * the output does not depend on the machine's time zone. */

export interface CalendarEvent {
  uid: string;
  title: string;
  /** Naive Europe/Warsaw wall-clock time, e.g. `2026-10-15T16:30:00`. */
  occursOn: string;
  groupName: string;
  /** Absolute URL of the Term page. */
  url: string;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const ZONE = "Europe/Warsaw";
const DURATION_HOURS = 1;
const MAX_LINE_BYTES = 75;

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
];

export function calendarUid(termId: string, itemId: string): string {
  return `${termId}-${itemId}@krag-grupy`;
}

function parseOccursOn(occursOn: string): WallClock {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(occursOn);
  if (!match) throw new Error(`Invalid occursOn: ${occursOn}`);
  const [year, month, day, hour, minute, second = "0"] = match.slice(1);
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
}

/** Wall-clock arithmetic done on the UTC timeline, which has no DST jumps,
 * so a 23:30 start simply rolls over to 00:30 the next day. */
function addHours(time: WallClock, hours: number): WallClock {
  const shifted = new Date(
    Date.UTC(time.year, time.month - 1, time.day, time.hour + hours, time.minute, time.second),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function formatBasic(time: WallClock): string {
  return (
    `${pad(time.year, 4)}${pad(time.month)}${pad(time.day)}` +
    `T${pad(time.hour)}${pad(time.minute)}${pad(time.second)}`
  );
}

function eventTimes(occursOn: string): { start: string; end: string } {
  const start = parseOccursOn(occursOn);
  return { start: formatBasic(start), end: formatBasic(addHours(start, DURATION_HOURS)) };
}

const describeEvent = (event: CalendarEvent) => `${event.groupName}\n${event.url}`;

export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const { start, end } = eventTimes(event.occursOn);
  const params = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(event.title)}`,
    `dates=${start}/${end}`,
    `ctz=${ZONE}`,
    `location=${encodeURIComponent(event.groupName)}`,
    `details=${encodeURIComponent(describeEvent(event))}`,
  ];
  return `https://calendar.google.com/calendar/render?${params.join("&")}`;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Splits a content line into physical lines of at most 75 UTF-8 bytes
 * (continuations start with one space), never inside a multi-byte character. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? MAX_LINE_BYTES : MAX_LINE_BYTES - 1;
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function utcStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function alarm(trigger: string, summary: string): string[] {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${trigger}`, `DESCRIPTION:${summary}`, "END:VALARM"];
}

/** `now` is used only for `DTSTAMP`; pass a fixed date for deterministic output. */
export function buildIcs(event: CalendarEvent, now: Date): string {
  const { start, end } = eventTimes(event.occursOn);
  const summary = escapeText(event.title);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Krag Grupy//Kalendarz//PL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...VTIMEZONE,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART;TZID=${ZONE}:${start}`,
    `DTEND;TZID=${ZONE}:${end}`,
    `SUMMARY:${summary}`,
    `LOCATION:${escapeText(event.groupName)}`,
    `DESCRIPTION:${escapeText(describeEvent(event))}`,
    ...alarm("-P1D", summary),
    ...alarm("-PT2H", summary),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** ASCII slug of the title plus `DD-MM`, e.g. `odbior-pucio-15-10.ics`. */
export function calendarFilename(title: string, occursOn: string): string {
  const { day, month } = parseOccursOn(occursOn);
  const slug = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "termin"}-${pad(day)}-${pad(month)}.ics`;
}

export function downloadIcs(event: CalendarEvent, now: Date): void {
  const blob = new Blob([buildIcs(event, now)], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = calendarFilename(event.title, event.occursOn);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers start the download asynchronously; revoking right away can cancel it.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
