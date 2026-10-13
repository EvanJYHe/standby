import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import { cn } from "../lib/cn.js";

export const container = "mx-auto w-full max-w-[1280px] px-6 md:px-10";

export const downloadHref = "/downloads/Standby.dmg";

const buttonBase =
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl font-medium leading-none tracking-[-0.01em] transition-colors duration-150";

export const primaryButton = cn(
  buttonBase,
  "h-12 bg-sb-blue px-[22px] text-[15px] text-white hover:bg-sb-blue-hover sm:text-[16px]",
);

export const smallButton = cn(buttonBase, "h-[38px] bg-sb-blue px-4 text-[14px] text-white hover:bg-sb-blue-hover");

export const whiteButton = cn(
  buttonBase,
  "h-12 bg-white px-[22px] text-[15px] text-sb-ink hover:bg-white/[0.88] sm:text-[16px]",
);

// Apple's logo, path from Simple Icons (CC0).
export function AppleLogo({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg aria-hidden="true" className={cn("shrink-0", className)} fill="currentColor" focusable="false" style={style} viewBox="0 0 24 24">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

export function DownloadLink({ className, children }: { className: string; children: ReactNode }) {
  return (
    <a className={cn(className, "gap-2")} download href={downloadHref}>
      <AppleLogo className="h-[15px] w-[15px] -translate-y-px" />
      {children}
    </a>
  );
}

export function revealDelay(ms: number): CSSProperties {
  return { "--sb-delay": `${ms}ms` } as CSSProperties;
}

export function SectionHeading({
  id,
  lead,
  rest,
  splitOnDesktop = false,
}: {
  id: string;
  lead: string;
  rest: string;
  splitOnDesktop?: boolean;
}) {
  return (
    <h2
      className={cn(
        "max-w-[760px] text-[clamp(34px,4vw,56px)] font-medium leading-[1.08] tracking-[-0.03em] text-sb-ink [text-wrap:balance]",
        splitOnDesktop && "lg:max-w-none",
      )}
      id={id}
    >
      {lead} {splitOnDesktop ? <br className="hidden lg:inline" /> : null}
      <span className="text-sb-muted">{rest}</span>
    </h2>
  );
}

// Resolves once the hero has painted (the first contentful paint), so the film, the app renders and Roboto never
// compete with the hero photo and fonts.
let firstPaint: Promise<void> | undefined;
export function afterFirstPaint(): Promise<void> {
  firstPaint ??= new Promise((resolve) => {
    const done = () => window.setTimeout(resolve, 0);
    if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("paint")) {
      return done();
    }
    new PerformanceObserver((list, observer) => {
      if (!list.getEntriesByName("first-contentful-paint").length) return;
      observer.disconnect();
      done();
    }).observe({ type: "paint", buffered: true });
    window.setTimeout(done, 3000);
  });
  return firstPaint;
}

export function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void afterFirstPaint().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}
