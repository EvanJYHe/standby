import geistUrl from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import serifUrl from "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url";

// Starts both latin font files alongside the landing chunk; LandingPage's fontsource CSS points at the same URLs.
export function preloadLandingFonts(): void {
  for (const href of [serifUrl, geistUrl]) {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "font";
    link.type = "font/woff2";
    link.crossOrigin = "anonymous";
    link.href = href;
    document.head.append(link);
  }
}

// Holds the first paint briefly so the hero never swaps typefaces (and shifts) mid-animation.
export async function waitForLandingFonts(timeoutMs = 1000): Promise<void> {
  if (!("fonts" in document)) return;
  const loaded = Promise.all([
    document.fonts.load('400 1em "Instrument Serif"'),
    document.fonts.load('500 1em "Geist Variable"'),
  ]).catch(() => undefined);
  await Promise.race([loaded, new Promise((resolve) => window.setTimeout(resolve, timeoutMs))]);
}
