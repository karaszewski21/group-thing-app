import dayjs from "../../utils/dayjs";

/** Audit timestamps (`created_at`, `last_message_at`) are naive UTC; show
 * them in the browser's local time. `term_occurs_on` is Warsaw wall-clock
 * and must never go through here. */
export function parseAuditTime(x: string): dayjs.Dayjs {
  return dayjs.utc(x).local();
}

/** Whole local days between `t` and now (0 = today, 1 = yesterday). */
function daysAgo(t: dayjs.Dayjs): number {
  return dayjs().startOf("day").diff(t.startOf("day"), "day");
}

export function formatBubbleTime(x: string): string {
  return parseAuditTime(x).format("HH:mm");
}

export function formatInboxTime(x: string): string {
  const t = parseAuditTime(x);
  const days = daysAgo(t);
  if (days <= 0) return t.format("HH:mm");
  if (days === 1) return "wczoraj";
  if (days <= 6) return t.format("ddd");
  if (t.year() === dayjs().year()) return t.format("DD.MM");
  return t.format("DD.MM.YYYY");
}

export function formatDaySeparator(x: string): string {
  const t = parseAuditTime(x);
  const days = daysAgo(t);
  if (days <= 0) return "dzisiaj";
  if (days === 1) return "wczoraj";
  if (t.year() === dayjs().year()) return t.format("dddd, D MMMM");
  return t.format("dddd, D MMMM YYYY");
}

/** Groups messages under one day separator. */
export function localDayKey(x: string): string {
  return parseAuditTime(x).format("YYYY-MM-DD");
}
