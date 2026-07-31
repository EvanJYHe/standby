import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";

import { cn } from "./ui.js";

export function MiniMonth({ anchorDate, onSelect }: {
  anchorDate: string;
  onSelect: (date: string) => void;
}) {
  const anchor = DateTime.fromISO(anchorDate);
  const [month, setMonth] = useState(anchor.startOf("month"));
  useEffect(() => setMonth(DateTime.fromISO(anchorDate).startOf("month")), [anchorDate]);
  const dates = useMemo(() => {
    const first = month.startOf("month");
    const start = first.minus({ days: first.weekday % 7 });
    return Array.from({ length: 42 }, (_, index) => start.plus({ days: index }));
  }, [month]);

  return (
    <section aria-label={`${month.toFormat("LLLL yyyy")} mini calendar`}>
      <div className="mb-3 flex items-center justify-between">
        <strong className="text-sm font-semibold">{month.toFormat("LLLL yyyy")}</strong>
        <div className="flex gap-1">
          <button aria-label="Previous month" className="grid h-7 w-7 place-items-center rounded-full text-lg text-muted hover:bg-white hover:text-ink" onClick={() => setMonth((value) => value.minus({ months: 1 }))} type="button">‹</button>
          <button aria-label="Next month" className="grid h-7 w-7 place-items-center rounded-full text-lg text-muted hover:bg-white hover:text-ink" onClick={() => setMonth((value) => value.plus({ months: 1 }))} type="button">›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-medium text-muted">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-0.5">
        {dates.map((date) => {
          const iso = date.toISODate()!;
          const selected = iso === anchorDate;
          return (
            <button
              aria-label={`Select ${date.toFormat("cccc, LLLL d")}`}
              aria-pressed={selected}
              className={cn(
                "mx-auto grid h-7 w-7 place-items-center rounded-full text-[11px] transition-colors hover:bg-white",
                date.month !== month.month && "text-[#b4b2ab]",
                selected && "bg-standby font-semibold text-ink shadow-[0_3px_8px_rgba(145,58,42,0.16)] hover:bg-[#ff8168]",
              )}
              key={iso}
              onClick={() => onSelect(iso)}
              type="button"
            >
              {date.day}
            </button>
          );
        })}
      </div>
    </section>
  );
}
