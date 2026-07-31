import { DateTime } from "luxon";

export type CalendarView = "day" | "week" | "month";

export interface CalendarPeriod {
  start: string;
  end: string;
  visibleDates: string[];
}

function parseDate(value: string): DateTime {
  const date = DateTime.fromISO(value, { zone: "America/Toronto" }).startOf("day");
  if (!date.isValid || date.toISODate() !== value) throw new Error(`Invalid calendar date: ${value}`);
  return date;
}

function isoDates(start: DateTime, count: number): string[] {
  return Array.from({ length: count }, (_, index) => start.plus({ days: index }).toISODate()!);
}

export function periodRange(anchorDate: string, view: CalendarView): CalendarPeriod {
  const anchor = parseDate(anchorDate);
  if (view === "day") {
    return { start: anchorDate, end: anchorDate, visibleDates: [anchorDate] };
  }
  if (view === "week") {
    const start = anchor.minus({ days: anchor.weekday % 7 });
    const visibleDates = isoDates(start, 7);
    return { start: visibleDates[0]!, end: visibleDates.at(-1)!, visibleDates };
  }
  const firstOfMonth = anchor.startOf("month");
  const start = firstOfMonth.minus({ days: firstOfMonth.weekday % 7 });
  const visibleDates = isoDates(start, 42);
  return { start: visibleDates[0]!, end: visibleDates.at(-1)!, visibleDates };
}

export function movePeriod(anchorDate: string, view: CalendarView, direction: -1 | 1): string {
  const anchor = parseDate(anchorDate);
  const moved = view === "day"
    ? anchor.plus({ days: direction })
    : view === "week"
      ? anchor.plus({ weeks: direction })
      : anchor.plus({ months: direction });
  return moved.toISODate()!;
}

export function periodLabel(anchorDate: string, view: CalendarView): string {
  const anchor = parseDate(anchorDate);
  if (view === "day") return anchor.toFormat("cccc, LLLL d");
  if (view === "month") return anchor.toFormat("LLLL yyyy");
  const range = periodRange(anchorDate, "week");
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  if (start.year === end.year && start.month === end.month) {
    return `${start.toFormat("LLLL d")}–${end.toFormat("d, yyyy")}`;
  }
  if (start.year === end.year) {
    return `${start.toFormat("LLLL d")}–${end.toFormat("LLLL d, yyyy")}`;
  }
  return `${start.toFormat("LLLL d, yyyy")}–${end.toFormat("LLLL d, yyyy")}`;
}

export function selectMonthDate(date: string): { anchorDate: string; view: "day" } {
  parseDate(date);
  return { anchorDate: date, view: "day" };
}
