import { useEffect } from "react";

import { afterFirstPaint, container, revealDelay, SectionHeading } from "./ui.js";
import { BookedVignette, CalendarVignette, WaitlistVignette } from "./Vignettes.js";

const features = [
  {
    title: "Syncs with Google Calendar.",
    copy: "It watches the calendars you pick and notices the moment an appointment is cancelled.",
    Vignette: CalendarVignette,
  },
  {
    title: "Knows who’s next.",
    copy: "Your waitlist is ranked by the service each person wants, then by who has waited longest.",
    Vignette: WaitlistVignette,
  },
  {
    title: "Fills the slot.",
    copy: "Standby offers the opening, and one click books the yes onto your calendar.",
    Vignette: BookedVignette,
  },
] as const;

export function Features() {
  useEffect(() => void afterFirstPaint().then(() => import("./google-font.css")), []);

  return (
    <section aria-labelledby="features-title" className="pt-[88px] md:pt-32">
      <div className={container}>
        <div className="sb-reveal">
          <SectionHeading
            id="features-title"
            lead={"Everything a good front desk would\u00a0do,"}
            rest="on the calendar you already use."
            splitOnDesktop
          />
        </div>
        <div className="mt-12 grid gap-10 md:mt-16 lg:grid-cols-3 lg:gap-5">
          {features.map(({ title, copy, Vignette }, index) => (
            <article className="sb-reveal" key={title} style={revealDelay(index * 80)}>
              <div aria-hidden="true" className="relative h-[320px] overflow-hidden rounded-2xl bg-[#eef1f5]" inert>
                <Vignette />
              </div>
              <h3 className="mt-6 px-1 text-[20px] font-semibold leading-[1.25] tracking-[-0.015em] text-sb-ink">{title}</h3>
              <p className="mt-2 max-w-[400px] px-1 text-[16px] leading-[1.55] text-sb-ink-2">{copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
