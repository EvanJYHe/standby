import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/geist";

import { useEffect, useRef } from "react";

import { ClosingCta } from "../landing/ClosingCta.js";
import { Features } from "../landing/Features.js";
import { Footer } from "../landing/Footer.js";
import { Hero } from "../landing/Hero.js";
import { HowItWorks } from "../landing/HowItWorks.js";
import { Nav } from "../landing/Nav.js";
import { useReducedMotion } from "../landing/ui.js";

export function LandingPage() {
  const reducedMotion = useReducedMotion();
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    if (!reducedMotion) root.style.scrollBehavior = "smooth";

    const items = [...(pageRef.current?.querySelectorAll<HTMLElement>(".sb-reveal") ?? [])];
    let observer: IntersectionObserver | undefined;
    if (reducedMotion || !("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("is-visible"));
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-visible");
            observer?.unobserve(entry.target);
          }
        },
        { threshold: 0.15 },
      );
      items.forEach((item) => observer?.observe(item));
    }

    return () => {
      observer?.disconnect();
      root.style.scrollBehavior = previousScrollBehavior;
    };
  }, [reducedMotion]);

  return (
    <div
      className="sb-page relative min-h-screen overflow-x-clip bg-sb-surface font-sb-sans text-sb-ink antialiased selection:bg-sb-blue selection:text-white"
      ref={pageRef}
    >
      <a
        className="fixed left-3 top-3 z-50 -translate-y-[200%] rounded-xl bg-sb-ink px-4 py-3 text-[14px] font-medium text-white focus:translate-y-0"
        href="#main"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero reducedMotion={reducedMotion} />
        <HowItWorks />
        <Features />
        <ClosingCta />
      </main>
      <Footer />
    </div>
  );
}
