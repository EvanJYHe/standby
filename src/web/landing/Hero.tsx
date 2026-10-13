import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "../lib/cn.js";
import { afterFirstPaint, container, DownloadLink, primaryButton } from "./ui.js";

const compactQuery = "(max-width: 899px)";
const film = { large: "/landing/v2/standby-film.mp4", compact: "/landing/v2/standby-film-1280.mp4" };
const poster = { large: "/landing/v2/standby-film-poster.jpg", compact: "/landing/v2/standby-film-poster-1280.jpg" };
// The poster is the film's frame at 2.6 s, so playback starts there and takes over without a cut.
const posterTime = 2.6;
// Measured against the photo: keeps the nav links and the lead at 4.5:1 or better on every hero size.
const legibilityGradient =
  "linear-gradient(to bottom, rgba(11,18,32,0.54) 0px, rgba(11,18,32,0.42) 64px, rgba(11,18,32,0.26) 160px, rgba(11,18,32,0.24) 40%, rgba(11,18,32,0.12) 55%, rgba(11,18,32,0) 70%)";

function Film({ reducedMotion }: { reducedMotion: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size] = useState<keyof typeof film>(() => (window.matchMedia(compactQuery).matches ? "compact" : "large"));

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    let live = true;
    void afterFirstPaint().then(() => {
      if (!live) return;
      video.muted = true;
      video.src = `${film[size]}#t=${posterTime}`;
    });
    return () => {
      live = false;
    };
  }, [reducedMotion, size]);

  if (reducedMotion) {
    return (
      <picture>
        <source media={compactQuery} srcSet={poster.compact} />
        <img alt="" className="block h-auto w-full" decoding="async" height={1350} src={poster.large} width={2400} />
      </picture>
    );
  }

  return (
    <video
      aria-hidden="true"
      autoPlay
      className="block h-auto w-full"
      height={1080}
      loop
      muted
      playsInline
      poster={poster[size]}
      preload="metadata"
      ref={videoRef}
      width={1920}
    />
  );
}

export function Hero({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <section aria-labelledby="hero-title" className="relative">
      <div className="relative flex min-h-[88svh] flex-col md:landscape:min-h-[100svh]">
        <div
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden bg-sb-mist [mask-image:linear-gradient(to_bottom,#000_calc(100%-160px),transparent)]"
        >
          <picture>
            <source media={compactQuery} srcSet="/landing/v2/hero-landscape-1200.jpg" />
            <img
              alt=""
              className="h-full w-full object-cover object-[50%_30%]"
              fetchPriority="high"
              height={1350}
              src="/landing/v2/hero-landscape.jpg"
              width={2400}
            />
          </picture>
          <div className="absolute inset-0" style={{ backgroundImage: legibilityGradient }} />
        </div>

        <div className={cn(container, "relative pt-[max(112px,20vh)] text-center")}>
          <h1
            className="font-sb-serif text-[min(56px,calc((100vw-48px)/6.5))] font-normal leading-[0.95] tracking-[-0.02em] text-white md:text-[clamp(56px,7.2vw,104px)]"
            id="hero-title"
          >
            <span className="block animate-sb-rise">Empty time,</span>{" "}
            <span className="block animate-sb-rise [animation-delay:80ms]">filled automatically.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-[560px] animate-sb-rise text-[clamp(17px,1.4vw,20px)] leading-[1.5] tracking-[-0.01em] text-white/[0.92] [animation-delay:120ms]">
            When a customer cancels, Standby finds the right person on your waitlist and books them into the open
            slot.
          </p>
          <div className="animate-sb-rise [animation-delay:200ms]">
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
              <DownloadLink className={primaryButton}>Download for Mac</DownloadLink>
              <a
                className="group inline-flex h-12 items-center gap-1.5 rounded-xl text-[15px] font-medium leading-none tracking-[-0.01em] text-white sm:text-[16px]"
                href="#how"
              >
                See how it works
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5"
                  strokeWidth={2}
                />
              </a>
            </div>
            <p className="mt-4 text-[13px] leading-[1.4] text-white/80">Free · macOS 14 or later</p>
          </div>
        </div>

        <div className={cn(container, "relative z-10 mt-auto pt-12 md:pt-16")}>
          <div className="mx-auto flow-root max-w-[1080px] animate-sb-rise-slow [--sb-rise:24px] [animation-delay:260ms]">
            <div className="relative isolate -mb-[18.75%] overflow-hidden rounded-[20px] bg-sb-mist shadow-sb-float">
              <Film reducedMotion={reducedMotion} />
              <div className="pointer-events-none absolute inset-0 rounded-[20px] ring-1 ring-inset ring-white/35" />
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className={container}>
        <div className="pt-[calc(min(1080px,100%)*0.1875)]" />
      </div>
    </section>
  );
}
