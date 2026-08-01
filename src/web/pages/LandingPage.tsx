import { useEffect, useState } from "react";
import {
  AudioWaveform,
  BadgeCheck,
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  PhoneCall,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react";
import {
  FaGithub,
} from "react-icons/fa6";

import { cn } from "../lib/cn.js";

const shellClass =
  "mx-auto w-[calc(100%_-_40px)] max-w-[1400px] max-[380px]:w-[calc(100%_-_32px)]";

const buttonClass =
  "inline-flex min-h-[50px] items-center justify-center rounded-[8px] border px-[22px] text-[12px] font-bold uppercase tracking-[0.08em] transition-[color,background-color,border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 focus-visible:outline-[3px_solid_rgba(243,111,86,0.42)] focus-visible:outline-offset-4 max-[720px]:min-h-[46px]";

const eyebrowClass =
  "m-0 inline-flex items-center text-[11px] font-bold uppercase leading-none tracking-[0.18em] text-landing-muted";

const footerLinkClass =
  "inline-flex h-10 items-center gap-2 rounded-[7px] px-3 text-[11px] font-bold uppercase tracking-[0.09em] text-[rgba(16,23,34,0.7)] transition-[color,background-color] hover:bg-[rgba(255,255,255,0.24)] hover:text-landing-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-landing-ink [&_svg]:h-[16px] [&_svg]:w-[16px]";

const serifClass = "font-landing-serif";

const featureCards = [
  {
    number: "01",
    title: "Find the perfect fit",
    copy:
      "Looks through the waitlist and picks someone sensible. There is math. Probably too much math.",
    image: "/landing/feature-match-v2.webp",
    height: 1800,
    alt: "A salon professional welcoming a customer at the front desk",
    position: "object-[50%_43%]",
    icon: UserRoundSearch,
  },
  {
    number: "02",
    title: "Voice agents that convert",
    copy:
      "Calls them. Explains the slot. Gets a yes or no. Sarah is the demo number, so be nice.",
    image: "/landing/feature-voice-v2.webp",
    height: 801,
    alt: "A voice headset beside a laptop",
    position: "object-[56%_58%]",
    icon: AudioWaveform,
  },
  {
    number: "03",
    title: "Book with confidence",
    copy:
      "Checks the slot is still free before booking it. The bar is low, but important.",
    image: "/landing/feature-booking-v2.webp",
    height: 801,
    alt: "An appointment-ready salon interior",
    position: "object-[50%_55%]",
    icon: BadgeCheck,
  },
] as const;

const workflowSteps = [
  {
    number: "01",
    title: "An opening appears",
    copy:
      "Someone cancels. Bad for the calendar. Great for this demo.",
    icon: CalendarClock,
  },
  {
    number: "02",
    title: "A voice agent makes the call",
    copy:
      "The agent calls Sarah. Sarah is whoever owns the configured phone number.",
    icon: PhoneCall,
  },
  {
    number: "03",
    title: "The calendar heals itself",
    copy:
      "She says yes, the slot moves, and everyone pretends this was easy.",
    icon: CalendarCheck2,
  },
] as const;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold tracking-[-0.025em]",
        compact ? "gap-[9px] text-[16px]" : "gap-2.5 text-[19px] max-[720px]:text-[17px]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid place-items-center overflow-hidden bg-transparent",
          compact
            ? "h-9 w-9 rounded-[8px]"
            : "h-11 w-11 rounded-[9px] max-[720px]:h-10 max-[720px]:w-10",
        )}
      >
        <img
          alt=""
          className="h-full w-full object-cover"
          decoding="async"
          fetchPriority="high"
          height="192"
          src="/landing/standby-mark.webp"
          width="192"
        />
      </span>
      <span>Standby</span>
    </span>
  );
}

function TimelineItem({
  active,
  Icon,
  title,
  copy,
  time,
}: {
  active: boolean;
  Icon: LucideIcon;
  title: string;
  copy: string;
  time: string;
}) {
  return (
    <div
      className={cn(
        "relative z-[1] grid min-h-[68px] grid-cols-[40px_1fr_auto] items-center gap-3 rounded-[8px] border px-[13px] py-[9px] pl-2 transition-[opacity,background-color,border-color,transform,box-shadow] duration-[420ms] max-[720px]:grid-cols-[40px_1fr]",
        active
          ? "translate-y-0 border-[rgba(16,23,34,0.08)] bg-white opacity-100 shadow-[0_5px_14px_rgba(16,23,34,0.06)]"
          : "translate-y-1 border-transparent bg-[#f4f3ee] opacity-[0.46]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-[38px] w-[38px] place-items-center rounded-[9px] border border-[rgba(67,84,107,0.16)] bg-[#f3f5f7] text-[#526176] transition-[color,background-color,border-color] duration-[420ms]",
          active && "border-[#c9d2dc] bg-[#eaf0f6] text-[#34465d]",
        )}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
      <span>
        <strong className="mb-[5px] block text-[14px] tracking-[-0.015em]">{title}</strong>
        <span className="text-[12px] leading-[1.4] text-[#7c8490]">{copy}</span>
      </span>
      <span className="self-start whitespace-nowrap pt-[5px] text-[10px] font-bold text-[#9da2aa] max-[720px]:hidden">
        {time}
      </span>
    </div>
  );
}

function RecoveryDemo({ step }: { step: number }) {
  const recovered = step >= 4;

  return (
    <div className="landing-intro-demo relative z-[2] mx-auto mt-9 w-[min(1180px,100%)] max-[720px]:mt-[30px]" id="demo">
      <div className="overflow-hidden rounded-[14px] border border-[rgba(16,23,34,0.12)] bg-landing-panel text-left shadow-[0_18px_50px_rgba(24,31,40,0.09)] max-[720px]:rounded-[10px]">
        <div className="grid min-h-[440px] grid-cols-[minmax(0,1.23fr)_minmax(300px,0.77fr)] overflow-hidden bg-landing-panel max-[1050px]:grid-cols-1">
          <div className="border-r border-[rgba(16,23,34,0.08)] px-7 py-6 max-[1050px]:border-b max-[1050px]:border-r-0 max-[720px]:px-4 max-[720px]:py-5">
            <h2
              className={cn(
                serifClass,
                "m-0 text-[32px] font-normal italic tracking-[-0.035em] max-[720px]:text-[27px]",
              )}
            >
              Cancellation detected. Voice agent already calling.
            </h2>

            <div
              aria-label="Animated cancellation recovery example"
              className="relative mt-[18px] grid gap-1.5 before:absolute before:bottom-[30px] before:left-[22px] before:top-[30px] before:z-0 before:w-px before:bg-[#dedfdc] before:content-['']"
            >
              <TimelineItem
                active={step >= 1}
                copy="A $68 opening appeared with Jeremy."
                Icon={CalendarX2}
                time="4:12 PM"
                title="Josh cancelled his haircut"
              />
              <TimelineItem
                active={step >= 2}
                copy="It offers the opening and answers her questions."
                Icon={PhoneCall}
                time="4:12 PM"
                title="The voice agent calls Sarah"
              />
              <TimelineItem
                active={step >= 3}
                copy="Schedule updated and the front desk notified."
                Icon={CalendarCheck2}
                time="4:14 PM"
                title="Sarah confirmed for 5:00 PM"
              />
            </div>

            <div className="mt-[14px] flex items-center justify-between gap-5 rounded-[8px] bg-landing-ink px-[18px] py-4 text-[#e9f1e8] max-[720px]:items-start max-[720px]:flex-col">
              <div>
                <p className="mb-1 mt-0 text-[10px] font-bold uppercase tracking-[0.12em] text-[#aeb8c5]">
                  Outcome
                </p>
                <strong className={cn(serifClass, "text-[24px] font-normal italic")}>
                  {recovered ? "Opening filled in 1m 48s" : "Recovering revenue…"}
                </strong>
              </div>
              <span className="text-[32px] font-semibold tracking-[-0.06em] text-white">
                {recovered ? "$68" : "$0"}
              </span>
            </div>
          </div>

          <div className="landing-schedule-grid flex min-h-0 flex-col px-6 pb-[22px] pt-6 max-[1050px]:min-h-[400px] max-[720px]:min-h-[380px] max-[720px]:px-4 max-[720px]:py-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="m-0 text-[13px] font-bold">Jeremy’s afternoon</p>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#969ca5]">
                Jul 30 · Toronto
              </span>
            </div>

            <div
              aria-label="Appointment recovery preview"
              className="grid min-h-[285px] flex-1 grid-cols-[34px_1fr] grid-rows-5"
            >
              <span className="pt-2 text-[9px] font-bold text-[#9ca1a8]">3 PM</span>
              <div className="relative">
                <div className="absolute left-2 right-0 flex min-h-[50px] items-center justify-between gap-3 rounded-[7px] border border-[rgba(16,23,34,0.08)] bg-white px-3 py-[9px] shadow-[0_4px_12px_rgba(16,23,34,0.06)]">
                  <span>
                    <strong className="mb-1 block text-[12px]">Michael</strong>
                    <small className="text-[10px] text-[#858d98]">Signature haircut</small>
                  </span>
                  <img
                    alt=""
                    aria-hidden="true"
                    className="h-8 w-8 flex-none rounded-full border-2 border-white object-cover shadow-[0_0_0_1px_rgba(16,23,34,0.1)]"
                    decoding="async"
                    height="128"
                    src="/landing/avatar-michael-v2.webp"
                    width="128"
                  />
                </div>
              </div>

              <span className="pt-2 text-[9px] font-bold text-[#9ca1a8]">4 PM</span>
              <div className="relative" />

              <span className="pt-2 text-[9px] font-bold text-[#9ca1a8]">5 PM</span>
              <div className="relative">
                <div
                  className={cn(
                    "absolute left-2 right-0 flex min-h-[50px] items-center justify-between gap-3 rounded-[7px] border px-3 py-[9px] shadow-[0_4px_12px_rgba(16,23,34,0.06)] transition-[opacity,transform,border-color,background-color] duration-[420ms]",
                    recovered
                      ? "scale-100 border-[rgba(111,157,119,0.35)] bg-[#f7fbf6] opacity-100"
                      : "border-[rgba(16,23,34,0.08)] bg-[rgba(251,225,217,0.45)] opacity-50",
                  )}
                >
                  <span>
                    <strong className="mb-1 block text-[12px]">
                      {recovered ? "Sarah · Confirmed" : "Josh · Cancelled"}
                    </strong>
                    <small className="text-[10px] text-[#858d98]">Signature haircut</small>
                  </span>
                  <span aria-hidden="true" className="relative h-8 w-8 flex-none">
                    <img
                      alt=""
                      className={cn(
                        "absolute inset-0 h-full w-full rounded-full border-2 border-white object-cover shadow-[0_0_0_1px_rgba(16,23,34,0.1)] transition-[filter,opacity] duration-[420ms]",
                        recovered ? "opacity-0" : "opacity-55 grayscale",
                      )}
                      decoding="async"
                      height="128"
                      src="/landing/avatar-josh-v2.webp"
                      width="128"
                    />
                    <img
                      alt=""
                      className={cn(
                        "absolute inset-0 h-full w-full rounded-full border-2 border-white object-cover shadow-[0_0_0_1px_rgba(16,23,34,0.1)] transition-opacity duration-[420ms]",
                        recovered ? "opacity-100" : "opacity-0",
                      )}
                      decoding="async"
                      height="128"
                      src="/landing/avatar-sarah-v2.webp"
                      width="128"
                    />
                  </span>
                </div>
              </div>

              <span className="pt-2 text-[9px] font-bold text-[#9ca1a8]">6 PM</span>
              <div className="relative" />

              <span className="pt-2 text-[9px] font-bold text-[#9ca1a8]">7 PM</span>
              <div className="relative" />
            </div>

            <div className="mt-3 flex items-center justify-between pt-3 text-[10px] text-[#848c97]">
              <span>Schedule health</span>
              <strong className="text-[11px] text-landing-sage-ink">
                {recovered ? "Schedule fully recovered" : "1 opening detected"}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [demoStep, setDemoStep] = useState(0);

  useEffect(() => {
    const previousTitle = document.title;
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    const previousBackgroundColor = root.style.backgroundColor;
    document.title = "Standby — Empty time, filled beautifully.";
    root.style.scrollBehavior = "smooth";
    root.style.backgroundColor = "#f2f0e9";

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealItems = [...document.querySelectorAll<HTMLElement>(".landing-reveal")];
    let observer: IntersectionObserver | undefined;

    if (reducedMotion || !("IntersectionObserver" in window)) {
      revealItems.forEach((item) => item.classList.add("is-visible"));
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-visible");
            observer?.unobserve(entry.target);
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -45px" },
      );
      revealItems.forEach((item) => observer?.observe(item));
    }

    return () => {
      observer?.disconnect();
      document.title = previousTitle;
      root.style.scrollBehavior = previousScrollBehavior;
      root.style.backgroundColor = previousBackgroundColor;
    };
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDemoStep(4);
      return;
    }

    let interval: number | undefined;
    const start = window.setTimeout(() => {
      let nextStep = 1;
      setDemoStep(nextStep);
      interval = window.setInterval(() => {
        nextStep = nextStep === 4 ? 1 : nextStep + 1;
        setDemoStep(nextStep);
      }, 540);
    }, 350);

    return () => {
      window.clearTimeout(start);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="landing-page min-h-screen overflow-x-hidden bg-landing-paper font-landing-sans text-landing-ink selection:bg-landing-ink selection:text-white">
      <a
        className="fixed left-3 top-3 z-[100] -translate-y-[180%] rounded-[10px] bg-landing-ink px-4 py-3 text-white transition-transform duration-200 focus:translate-y-0"
        href="#main"
      >
        Skip to content
      </a>

      <div
        className={cn(
          shellClass,
          "landing-intro-nav relative z-50 pt-5 max-[720px]:pt-4",
        )}
      >
        <nav
          aria-label="Primary navigation"
          className="flex min-h-[78px] items-center justify-between rounded-[10px] border border-[rgba(16,23,34,0.1)] bg-landing-panel py-3 pl-[18px] pr-[14px] shadow-[0_14px_34px_rgba(16,23,34,0.08)] max-[720px]:min-h-[66px] max-[720px]:rounded-[8px] max-[720px]:p-[10px]"
        >
          <a aria-label="Standby home" href="#top">
            <Brand />
          </a>

          <div className="ml-auto flex items-center gap-[34px] pr-[38px] text-[13px] font-semibold text-[#48515f] max-[1050px]:hidden">
            <a className="landing-nav-link" href="#product">Product</a>
            <a className="landing-nav-link" href="#how-it-works">How it works</a>
            <a className="landing-nav-link" href="#impact">Impact</a>
          </div>

          <a
            className={cn(
              buttonClass,
              "border-landing-ink bg-landing-ink text-white shadow-[0_8px_18px_rgba(16,23,34,0.16)] hover:bg-[#26303d] hover:shadow-[0_10px_24px_rgba(16,23,34,0.2)] max-[720px]:min-h-[42px] max-[720px]:px-[14px] max-[720px]:text-[9px]",
            )}
            href="/app"
          >
            Open product
          </a>
        </nav>
      </div>

      <main id="main">
        <section
          className={cn(
            shellClass,
            "relative pb-[52px] pt-11 text-center max-[720px]:pb-[52px] max-[720px]:pt-[42px]",
          )}
          id="top"
        >
          <div className="relative z-[2] mx-auto w-[min(1020px,100%)]">
            <h1 className="mb-5 mt-0 text-[clamp(64px,8.4vw,126px)] font-[430] leading-[0.84] tracking-[-0.075em] max-[720px]:text-[clamp(54px,17vw,82px)] max-[720px]:leading-[0.9]">
              <span className="landing-intro-line landing-intro-line--one block">
                Empty time,
              </span>
              <em
                className={cn(
                  serifClass,
                  "landing-intro-line landing-intro-line--two block pb-[0.13em] pt-[0.05em] text-[0.93em] font-normal leading-[0.92] tracking-[-0.045em]",
                )}
              >
                filled beautifully.
              </em>
            </h1>
            <p className="landing-intro-copy mx-auto w-[min(690px,100%)] text-[clamp(17px,1.8vw,21px)] leading-[1.55] tracking-[-0.018em] text-landing-muted max-[720px]:w-[min(92%,540px)] max-[720px]:text-[16px]">
              AI voice agents call the right customers, handle the conversation, and refill
              cancelled appointments before the hour disappears.
            </p>
            <div className="landing-intro-actions mt-6 flex flex-wrap justify-center gap-3 max-[720px]:mx-auto max-[720px]:w-[min(330px,100%)] max-[720px]:flex-col max-[720px]:items-stretch">
              <a
                className={cn(
                  buttonClass,
                  "border-landing-coral bg-landing-coral text-landing-ink shadow-[0_8px_18px_rgba(145,58,42,0.18)] hover:border-[#ff8168] hover:bg-[#ff8168] hover:shadow-[0_10px_24px_rgba(145,58,42,0.22)]",
                )}
                href="#demo"
              >
                Watch a slot refill
              </a>
              <a
                className={cn(
                  buttonClass,
                  "border-[rgba(16,23,34,0.15)] bg-landing-panel hover:border-[rgba(16,23,34,0.3)] hover:bg-white",
                )}
                href="/app"
              >
                Open the product
              </a>
            </div>
          </div>

          <RecoveryDemo step={demoStep} />
        </section>

        <section
          className="landing-section-rule relative bg-landing-panel py-[110px] max-[720px]:py-[82px]"
          id="product"
        >
          <div className={shellClass}>
            <div className="landing-reveal mb-[54px] flex flex-col items-center text-center max-[720px]:mb-12">
              <p className={cn(eyebrowClass, "mb-[22px]")}>
                AI voice agents for the front desk
              </p>
              <h2 className="m-0 max-w-[980px] text-[clamp(50px,6.2vw,92px)] font-normal leading-[0.92] tracking-[-0.065em] max-[720px]:text-[clamp(47px,14vw,66px)]">
                Calls that turn openings{" "}
                <em className={cn(serifClass, "font-normal")}>into revenue.</em>
              </h2>
              <p className="mx-auto mb-0 mt-5 max-w-[610px] text-[17px] leading-[1.55] text-landing-muted">
                It calls people for you. That is most of the pitch, honestly.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4 max-[1050px]:grid-cols-2 max-[720px]:grid-cols-1">
              {featureCards.map((card, index) => (
                <article
                  className={cn(
                    "landing-reveal relative min-h-[440px] overflow-hidden rounded-[14px] border border-[rgba(16,23,34,0.1)] bg-white p-[30px] max-[720px]:min-h-[425px]",
                    index === 2 && "max-[1050px]:col-span-2 max-[720px]:col-span-1",
                  )}
                  key={card.number}
                >
                  <span aria-hidden="true" className="flex h-11 items-center gap-3 text-landing-ink">
                    <card.icon className="h-7 w-7" strokeWidth={1.55} />
                    <span className="h-[2px] w-7 bg-landing-coral" />
                  </span>
                  <h3 className="mb-[11px] mt-[23px] text-[25px] font-semibold tracking-[-0.04em]">
                    {card.title}
                  </h3>
                  <p className="m-0 max-w-[320px] text-[14px] leading-[1.55] text-landing-muted">
                    {card.copy}
                  </p>
                  <figure className="absolute bottom-[26px] left-[25px] right-[25px] m-0 h-[185px] overflow-hidden rounded-[8px] border border-[rgba(16,23,34,0.08)] bg-[#e6e5e1]">
                    <img
                      alt={card.alt}
                      className={cn(
                        "block h-full w-full object-cover saturate-[0.62] contrast-[0.94]",
                        card.position,
                      )}
                      decoding="async"
                      height={card.height}
                      loading="lazy"
                      src={card.image}
                      width="1200"
                    />
                  </figure>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-[105px] max-[720px]:py-[95px]" id="how-it-works">
          <div
            className={cn(
              shellClass,
              "grid grid-cols-[0.9fr_1.1fr] items-center gap-[72px] max-[1050px]:grid-cols-1 max-[1050px]:gap-10 max-[720px]:gap-8",
            )}
          >
            <div className="landing-reveal">
              <p className={eyebrowClass}>From cancellation to confirmation</p>
              <h2 className="mb-5 mt-[22px] text-[clamp(50px,6vw,88px)] font-normal leading-[0.91] tracking-[-0.068em] max-[720px]:text-[clamp(47px,14vw,66px)]">
                Your schedule,
                <br />
                <em className={cn(serifClass, "font-normal")}>always in motion.</em>
              </h2>
              <p className="m-0 max-w-[470px] text-[17px] leading-[1.6] text-landing-muted">
                Cancellation in, phone call out, calendar fixed. Yada yada. You get it.
              </p>
            </div>

            <div className="grid gap-[10px]">
              {workflowSteps.map((workflow) => (
                <article
                  className="landing-reveal grid min-h-[132px] grid-cols-[48px_1fr] items-start gap-[18px] rounded-[12px] border border-[rgba(16,23,34,0.09)] bg-landing-panel px-[22px] py-5 transition-[background-color,transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:bg-white hover:shadow-[0_12px_28px_rgba(16,23,34,0.08)] max-[720px]:grid-cols-[44px_1fr] max-[720px]:gap-[14px] max-[720px]:p-[18px]"
                  key={workflow.number}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 items-center text-landing-ink"
                  >
                    <workflow.icon className="h-7 w-7" strokeWidth={1.55} />
                  </span>
                  <div>
                    <h3 className="mb-[7px] mt-0.5 text-[20px] font-semibold tracking-[-0.035em]">
                      {workflow.title}
                    </h3>
                    <p className="m-0 max-w-[510px] text-[14px] leading-[1.5] text-landing-muted">
                      {workflow.copy}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="landing-dark-grid relative overflow-hidden bg-landing-ink py-[108px] text-[#f7f7f3] max-[720px]:py-[72px]"
          id="impact"
        >
          <div className={cn(shellClass, "relative z-[2]")}>
            <div className="landing-reveal mx-auto mb-[58px] max-w-[1220px] text-center max-[720px]:mb-11 max-[720px]:text-left">
              <p className={cn(eyebrowClass, "justify-center text-[#aab3c0] max-[720px]:justify-start")}>
                Less empty time. More momentum.
              </p>
              <h2 className="mb-[18px] mt-5 text-[clamp(52px,5.6vw,86px)] font-normal leading-[0.9] tracking-[-0.062em] max-[720px]:mb-5 max-[720px]:mt-[18px] max-[720px]:text-[clamp(46px,13.2vw,58px)] max-[720px]:leading-[0.94] max-[720px]:tracking-[-0.052em]">
                <span className="block whitespace-nowrap max-[720px]:whitespace-normal">
                  Your calendar is inventory.
                </span>
                <em className={cn(serifClass, "block font-normal text-landing-coral")}>
                  Protect every hour.
                </em>
              </h2>
              <p className="mx-auto my-0 w-[min(680px,100%)] text-[16px] leading-[1.55] text-[#aeb7c3] max-[720px]:mx-0 max-[720px]:text-[15px] max-[720px]:leading-[1.65]">
                Fewer empty hours. More money, probably. We ran out of tasteful ways to
                say that two sections ago.
              </p>
            </div>

            <div className="landing-reveal grid grid-cols-3 border-y border-[rgba(255,255,255,0.13)] max-[720px]:grid-cols-1">
              {[
                ["<2 min", "roughly how long the good demo path takes"],
                ["24 / 7", "in the marketing sense of the phrase"],
                ["100%", "of the logs we remembered to add"],
              ].map(([value, label], index) => (
                <div
                  className={cn(
                    "min-h-[190px] border-r border-[rgba(255,255,255,0.13)] px-9 py-8 last:border-r-0 max-[720px]:flex max-[720px]:min-h-0 max-[720px]:items-center max-[720px]:justify-between max-[720px]:gap-6 max-[720px]:border-b max-[720px]:border-r-0 max-[720px]:px-4 max-[720px]:py-8 max-[720px]:last:border-b-0 max-[380px]:gap-4 max-[380px]:px-3",
                    index === 2 && "border-r-0",
                  )}
                  key={value}
                >
                  <strong
                    className={cn(
                      serifClass,
                      "mb-4 block text-[clamp(54px,5vw,78px)] font-normal italic tracking-[-0.055em] text-landing-coral max-[720px]:mb-0 max-[720px]:shrink-0 max-[720px]:whitespace-nowrap max-[720px]:text-[clamp(46px,13vw,58px)] max-[380px]:text-[44px]",
                    )}
                  >
                    {value}
                  </strong>
                  <span className="block max-w-60 text-[13px] leading-[1.55] text-[#b2bbc6] max-[720px]:max-w-[155px] max-[720px]:text-right max-[720px]:leading-[1.6]">
                    {label}
                  </span>
                </div>
              ))}
            </div>

            <div className="landing-reveal mx-auto mt-[70px] grid max-w-[1300px] grid-cols-[290px_minmax(0,1fr)] items-center gap-12 max-[1050px]:max-w-[860px] max-[1050px]:grid-cols-1 max-[1050px]:gap-[34px] max-[720px]:mt-14 max-[720px]:gap-7">
              <div className="flex items-center gap-6 max-[720px]:order-2 max-[720px]:gap-[18px]">
                <img
                  alt=""
                  aria-hidden="true"
                  className="h-[164px] w-[164px] shrink-0 rounded-full border-2 border-[rgba(255,255,255,0.45)] object-cover shadow-[0_0_0_1px_rgba(255,255,255,0.12)] max-[720px]:h-[88px] max-[720px]:w-[88px]"
                  decoding="async"
                  height="256"
                  loading="lazy"
                  src="/landing/avatar-aaron-su-v2.webp"
                  width="256"
                />
                <span>
                  <strong className="mb-[9px] block text-[22px] max-[720px]:mb-1.5 max-[720px]:text-[19px]">Aaron Su</strong>
                  <span className="block text-[13px] uppercase tracking-[0.14em] text-[#919ca9] max-[720px]:text-[11px]">
                    The Don
                  </span>
                </span>
              </div>
              <blockquote
                className={cn(
                  serifClass,
                  "m-0 text-[clamp(31px,3.5vw,51px)] italic leading-[1.08] tracking-[-0.04em] max-[720px]:order-1 max-[720px]:text-[clamp(31px,9vw,38px)] max-[720px]:leading-[1.12] max-[720px]:tracking-[-0.03em]",
                )}
              >
                “Wowie, this is so awesome sauce!!! Anyways, have you guys heard of{" "}
                <a
                  className="underline decoration-[1.5px] underline-offset-[0.12em] transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
                  href="https://one-million-notes.vercel.app/"
                  rel="noreferrer"
                  target="_blank"
                >
                  One Million Notes
                </a>?”
              </blockquote>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-landing-coral pb-10 pt-[150px] max-[720px]:pt-[90px]">
          <div className={shellClass}>
            <div className="landing-reveal relative z-[2] flex items-end justify-between gap-[60px] rounded-[14px] border border-[rgba(16,23,34,0.1)] bg-landing-panel p-[70px] shadow-[0_24px_60px_rgba(101,40,29,0.17)] max-[1050px]:flex-col max-[1050px]:items-start max-[720px]:rounded-[10px] max-[720px]:px-[25px] max-[720px]:py-[42px]">
              <div>
                <p className={eyebrowClass}>Put your empty hours back to work</p>
                <h2 className="mb-0 mt-[25px] max-w-[860px] text-[clamp(58px,7vw,104px)] font-normal leading-[0.88] tracking-[-0.072em] max-[720px]:text-[clamp(52px,16vw,74px)]">
                  Never let a good slot{" "}
                  <em className={cn(serifClass, "font-normal")}>go quiet.</em>
                </h2>
              </div>
              <a
                className={cn(
                  buttonClass,
                  "mb-1.5 flex-none border-landing-ink bg-landing-ink text-white shadow-[0_8px_18px_rgba(16,23,34,0.16)] hover:bg-[#26303d] hover:shadow-[0_10px_24px_rgba(16,23,34,0.2)]",
                )}
                href="/app"
              >
                Open Standby
              </a>
            </div>

            <footer className="mt-10 border-t border-[rgba(16,23,34,0.2)] px-1 py-6 text-landing-ink">
              <div className="flex items-center justify-between gap-8 max-[720px]:flex-col max-[720px]:items-start max-[720px]:gap-4">
                <div className="flex items-center gap-4 max-[520px]:items-start">
                  <Brand compact />
                  <span aria-hidden="true" className="h-7 w-px bg-[rgba(16,23,34,0.2)]" />
                  <p className="m-0 max-w-[310px] text-[13px] leading-5 text-[rgba(16,23,34,0.68)]">
                    Voice agents for cancelled appointments.
                  </p>
                </div>
                <nav aria-label="Standby links" className="flex items-center gap-1 max-[720px]:-ml-3">
                  <a
                    className={footerLinkClass}
                    href="https://github.com/EvanJYHe/standby"
                    rel="noreferrer"
                    target="_blank"
                  >
                    <FaGithub aria-hidden="true" />
                    GitHub
                  </a>
                </nav>
              </div>
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}
