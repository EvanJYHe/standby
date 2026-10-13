import { Mark } from "./Lockup.js";
import { AppleLogo, container, revealDelay, SectionHeading, useAfterFirstPaint } from "./ui.js";

const beats = [
  { title: "Connect Google Calendar.", copy: "Sign in with Google and pick the calendars to watch." },
  { title: "Keep a waitlist.", copy: "Add the people who want an earlier spot." },
  { title: "Fill every opening.", copy: "When someone cancels, Standby offers the slot and books the yes." },
] as const;

// Lengths in macOS points, scaled by the scene's --s so the popover's text stays legible on phones.
const pt = (value: number) => `calc(var(--s) * ${value}px)`;
const bar = 24;
const popover = { width: 380, height: 560, gap: 6, edge: 8 };

function WifiIcon() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" style={{ height: pt(12), width: pt(16) }} viewBox="0 0 16 12">
      <path d="M1.05 4.6a9.8 9.8 0 0 1 13.9 0" strokeWidth="1.7" />
      <path d="M3.6 7.15a6.2 6.2 0 0 1 8.8 0" strokeWidth="1.7" />
      <path d="M8 11.4 5.95 9.35a2.9 2.9 0 0 1 4.1 0Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BatteryIcon() {
  return (
    <svg aria-hidden="true" style={{ height: pt(12), width: pt(26) }} viewBox="0 0 26 12">
      <rect fill="none" height="11" rx="3.4" stroke="currentColor" strokeOpacity="0.45" width="22" x="0.5" y="0.5" />
      <rect fill="currentColor" height="8" rx="2" width="16" x="2" y="2" />
      <path d="M24 4.2c.9.2 1.4.9 1.4 1.8s-.5 1.6-1.4 1.8Z" fill="currentColor" fillOpacity="0.45" />
    </svg>
  );
}

function MenuBar() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-[rgba(22,28,38,0.22)] font-sb-system text-white/85 backdrop-blur-xl"
      inert
      style={{ height: pt(bar), paddingInline: pt(18), fontSize: pt(13) }}
    >
      <div className="flex items-center" style={{ gap: pt(20) }}>
        <AppleLogo className="text-white" style={{ height: pt(15), width: pt(15), marginTop: pt(-2) }} />
        <span className="font-semibold text-white">Standby</span>
        {["Edit", "Window", "Help"].map((menu) => (
          <span className="hidden sm:inline" key={menu}>
            {menu}
          </span>
        ))}
      </div>
      <div className="flex items-center" style={{ gap: pt(14) }}>
        <span className="relative grid place-items-center bg-white/20" style={{ height: pt(22), paddingInline: pt(7), borderRadius: pt(5) }}>
          <Mark color="white" height={15} style={{ height: pt(15), width: pt(15 * 0.951) }} />
          <span className="absolute rounded-full bg-sb-blue" style={{ top: pt(2), right: pt(3), width: pt(6), height: pt(6) }} />
        </span>
        <WifiIcon />
        <BatteryIcon />
        <span className="tabular-nums">Fri 4:12 PM</span>
      </div>
    </div>
  );
}

function MenuBarScene() {
  const ready = useAfterFirstPaint();
  return (
    <div
      className="relative overflow-hidden rounded-[24px] bg-[#5f6976] [--s:0.86] sm:[--s:0.95] lg:[--s:1] xl:[--s:1.1]"
      style={{ height: pt(bar + popover.gap + popover.height + 50) }}
    >
      {ready ? (
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[30%_50%]"
          decoding="async"
          height={1148}
          loading="lazy"
          src="/landing/v2/standby-wallpaper.jpg"
          width={2044}
        />
      ) : null}
      <MenuBar />
      <div className="absolute" style={{ top: pt(bar + popover.gap), right: pt(popover.edge), width: pt(popover.width) }}>
        {ready ? (
          <img
            alt="Standby open from the menu bar: Josh cancelled today’s 5:00 PM haircut, Sarah said yes, and a Book Sarah button waits above today’s appointments."
            className="-ml-[15.79%] -mt-[15.79%] block w-[131.58%] max-w-none"
            decoding="async"
            height={680}
            loading="lazy"
            src="/landing/v2/app/popover-openings.webp"
            width={500}
          />
        ) : null}
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="scroll-mt-[-56px] pt-[88px] md:pt-32" id="how">
      <div className={container}>
        <div className="sb-reveal">
          <SectionHeading id="how-title" lead={"Lives in your menu\u00a0bar,"} rest="and in your Google Calendar." splitOnDesktop />
        </div>
        <div className="sb-reveal mt-12 md:mt-16">
          <MenuBarScene />
        </div>
        <div className="mt-12 grid gap-8 md:mt-14 md:grid-cols-3 md:gap-10">
          {beats.map(({ title, copy }, index) => (
            <div className="sb-reveal" key={title} style={revealDelay(index * 80)}>
              <h3 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.015em] text-sb-ink">{title}</h3>
              <p className="mt-2 max-w-[340px] text-[16px] leading-[1.55] text-sb-ink-2">{copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
