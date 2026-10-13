import type { CSSProperties, ReactNode } from "react";

import { cn } from "../lib/cn.js";
import { useAfterFirstPaint } from "./ui.js";

// Google's event colours (Peacock, Sage, Grape) and the sample day the Mac app renders (Friday, October 9, 4:12 PM).
const peacock = "#039be5";
const hour = 44;
const gridTop = 10;
const at = (time: number) => gridTop + (time - 15) * hour;

function Window({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-5 -bottom-6 top-6 mx-auto max-w-[400px] overflow-hidden rounded-xl border border-sb-line bg-white font-sb-google shadow-[0_16px_40px_rgba(11,18,32,0.08)] lg:inset-x-4 xl:inset-x-6">
      {children}
    </div>
  );
}

function Chevron({ flip = false }: { flip?: boolean }) {
  return (
    <svg className={cn("h-4 w-4", flip && "-scale-x-100")} fill="none" stroke="#444746" strokeWidth="2" viewBox="0 0 24 24">
      <path d="m14.5 6-6 6 6 6" />
    </svg>
  );
}

function Event({
  title,
  time,
  start,
  end,
  color = peacock,
  cancelled = false,
  className,
}: {
  title: string;
  time: string;
  start: number;
  end: number;
  color?: string;
  cancelled?: boolean;
  className?: string;
}) {
  const height = (end - start) * hour - 2;
  const short = height < 30;
  const style: CSSProperties = cancelled
    ? { top: at(start) + 1, height, color, borderColor: color, backgroundColor: "#fff" }
    : { top: at(start) + 1, height, backgroundColor: color };
  return (
    <div
      className={cn(
        "absolute overflow-hidden rounded px-1.5 text-[11px] leading-[14px]",
        short ? "pt-[3px]" : "pt-1",
        cancelled ? "border line-through" : "text-white",
        className,
      )}
      style={style}
    >
      {short ? (
        <p className="truncate">
          <span className="font-medium">{title}</span>, {time}
        </p>
      ) : (
        <>
          <p className="truncate font-medium">{title}</p>
          <p className="truncate">{time}</p>
        </>
      )}
    </div>
  );
}

export function CalendarVignette() {
  return (
    <Window>
      <div className="flex h-[52px] items-center gap-1.5 px-3">
        <span className="mr-1 inline-flex h-7 items-center rounded-full border border-[#747775] px-3 text-[12px] font-medium text-[#1f1f1f]">
          Today
        </span>
        <Chevron />
        <Chevron flip />
        <span className="ml-1.5 truncate text-[15px] text-[#3c4043]">Friday, October 9</span>
      </div>
      <div className="relative">
        {["3 PM", "4 PM", "5 PM", "6 PM", "7 PM", "8 PM"].map((label, index) => (
          <div className="absolute inset-x-0 flex items-center" key={label} style={{ top: gridTop + index * hour }}>
            <span className="w-10 -translate-y-px pr-2 text-right text-[10px] text-[#70757a]">{label}</span>
            <span className="h-px flex-1 bg-[#dadce0]" />
          </div>
        ))}
        <div className="absolute bottom-[-400px] left-12 top-0 w-px bg-[#dadce0]" />
        <span className="absolute left-12 right-0 h-0.5 bg-[#ea4335]" style={{ top: at(16.2) - 1 }} />
        <div className="absolute left-[49px] right-2.5 top-0">
          <Event className="inset-x-0 opacity-[0.55]" end={15.75} start={15} time="3 – 3:45pm" title="Michael · Haircut" />
          <Event className="inset-x-0" color="#33b679" end={16.5} start={16} time="4 – 4:30pm" title="Walk-ins" />
          <Event cancelled className="left-0 right-[calc(50%+1px)]" end={18} start={17} time="5 – 6pm" title="Josh · Haircut" />
          <Event className="sb-appear left-[calc(50%+1px)] right-0" end={18} start={17} time="5 – 6pm" title="Sarah · Haircut" />
          <Event className="inset-x-0" color="#8e24aa" end={19.25} start={18.5} time="6:30 – 7:15pm" title="Ava · Colour" />
          <Event className="inset-x-0" end={20} start={19.5} time="7:30 – 8pm" title="Leo · Beard trim" />
        </div>
        <span className="absolute left-[43px] h-2.5 w-2.5 rounded-full bg-[#ea4335]" style={{ top: at(16.2) - 5 }} />
      </div>
    </Window>
  );
}

const waitlist = [
  { name: "Sarah Chen", phone: "(416) 555-0142", service: "Haircut", color: "#188038" },
  { name: "Daniel Okafor", phone: "(647) 555-0119", service: "Beard trim", color: "#9334e6" },
  { name: "Priya Raman", phone: "(416) 555-0187", service: "Any", color: "#e8710a" },
] as const;

export function WaitlistVignette() {
  return (
    <Window>
      <p className="px-4 pb-2 pt-4 text-[15px] text-[#1f1f1f]">
        Waitlist <span className="text-[#5f6368]">(3)</span>
      </p>
      <ul>
        {waitlist.map(({ name, phone, service, color }, index) => (
          <li className="flex items-center gap-3 px-4 py-2.5" key={name}>
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-medium text-white"
              style={{ backgroundColor: color }}
            >
              {name[0]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-[#1f1f1f]">{name}</span>
                {index === 0 ? (
                  <span className="rounded-full bg-sb-blue px-1.5 py-px font-sb-sans text-[10px] font-medium leading-[14px] text-white">
                    Next
                  </span>
                ) : null}
              </span>
              <span className="block text-[12px] text-[#5f6368]">{phone}</span>
            </span>
            <span className="shrink-0 rounded-lg bg-[#f1f3f4] px-2.5 py-1 text-[11px] font-medium text-[#3c4043]">{service}</span>
          </li>
        ))}
        <li className="flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium text-[#0b57d0]">
          <span className="grid h-8 w-8 place-items-center">
            <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          Add person
        </li>
      </ul>
    </Window>
  );
}

export function BookedVignette() {
  const ready = useAfterFirstPaint();
  return (
    <div className="absolute inset-x-5 top-6 mx-auto max-w-[360px] lg:inset-x-4 xl:inset-x-6">
      {ready ? (
        <img
          alt=""
          className="-ml-[15.79%] -mt-[15.79%] block w-[131.58%] max-w-none"
          decoding="async"
          height={680}
          loading="lazy"
          src="/landing/v2/app/popover-booked.webp"
          width={500}
        />
      ) : null}
    </div>
  );
}
