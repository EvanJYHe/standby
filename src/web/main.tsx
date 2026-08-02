import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";

import "./styles.css";

const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
const isProductRoute = normalizedPath === "/app";
const RoutedApp = isProductRoute
  ? lazy(async () => {
    const module = await import("./auth/ProductEntry.js");
    return { default: module.ProductEntry };
  })
  : lazy(async () => {
    const module = await import("./pages/LandingPage.js");
    return { default: module.LandingPage };
  });

document.title = isProductRoute
  ? "Standby — Front desk"
  : "Standby — Empty time, filled automatically.";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <RoutedApp />
    </Suspense>
    <Analytics />
  </StrictMode>,
);
