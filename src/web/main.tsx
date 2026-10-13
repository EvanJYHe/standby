import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";

import "./styles.css";
import { preloadLandingFonts, waitForLandingFonts } from "./landing/fonts.js";

const LandingPage = lazy(async () => {
  preloadLandingFonts();
  const module = await import("./pages/LandingPage.js");
  await waitForLandingFonts();
  return { default: module.LandingPage };
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div className="min-h-screen bg-sb-mist" />}>
      <LandingPage />
    </Suspense>
    <Analytics />
  </StrictMode>,
);
