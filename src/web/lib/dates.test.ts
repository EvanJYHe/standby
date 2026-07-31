import { describe, expect, it } from "vitest";

import { movePeriod, periodLabel, periodRange, selectMonthDate } from "./dates.js";

describe("calendar period helpers", () => {
  it("creates one-day and Sunday-to-Saturday calendar ranges", () => {
    expect(periodRange("2026-07-22", "day")).toEqual({
      start: "2026-07-22",
      end: "2026-07-22",
      visibleDates: ["2026-07-22"],
    });
    expect(periodRange("2026-07-22", "week")).toEqual({
      start: "2026-07-19",
      end: "2026-07-25",
      visibleDates: [
        "2026-07-19",
        "2026-07-20",
        "2026-07-21",
        "2026-07-22",
        "2026-07-23",
        "2026-07-24",
        "2026-07-25",
      ],
    });
  });

  it("creates a six-week month grid within the API's 42-day limit", () => {
    const range = periodRange("2026-07-18", "month");

    expect(range.start).toBe("2026-06-28");
    expect(range.end).toBe("2026-08-08");
    expect(range.visibleDates).toHaveLength(42);
  });

  it("moves by the selected period and formats restrained labels", () => {
    expect(movePeriod("2026-07-20", "day", 1)).toBe("2026-07-21");
    expect(movePeriod("2026-07-20", "week", -1)).toBe("2026-07-13");
    expect(movePeriod("2026-07-20", "month", 1)).toBe("2026-08-20");
    expect(periodLabel("2026-07-20", "day")).toBe("Monday, July 20");
    expect(periodLabel("2026-07-20", "week")).toBe("July 19–25, 2026");
    expect(periodLabel("2026-07-20", "month")).toBe("July 2026");
  });

  it("turns a selected month cell into a day view", () => {
    expect(selectMonthDate("2026-08-03")).toEqual({
      anchorDate: "2026-08-03",
      view: "day",
    });
  });
});
