import { lazy, Suspense, useCallback, useState } from "react";

import { AuthPage, type LocalProfileInput } from "./AuthPage.js";
import {
  clearProductSession,
  readProductSession,
  saveProductSession,
  type ProductSession,
} from "./session.js";

const DashboardApp = lazy(async () => {
  const module = await import("../App.js");
  return { default: module.DashboardApp };
});

function DashboardFallback() {
  return (
    <div
      aria-label="Opening workspace"
      className="grid min-h-screen place-items-center bg-canvas font-landing-sans text-ink"
      role="status"
    >
      <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-muted">
        Opening Standby…
      </span>
    </div>
  );
}

export function ProductEntry() {
  const [session, setSession] = useState<ProductSession | undefined>(() => readProductSession());

  const enterSession = useCallback((nextSession: ProductSession) => {
    saveProductSession(nextSession);
    setSession(nextSession);
  }, []);

  const createLocalProfile = useCallback((profile: LocalProfileInput) => {
    enterSession({ kind: "local", name: profile.name, email: profile.email });
  }, [enterSession]);

  const enterDemo = useCallback(() => {
    enterSession({ kind: "demo" });
  }, [enterSession]);

  const signOut = useCallback(() => {
    clearProductSession();
    setSession(undefined);
  }, []);

  if (session === undefined) {
    return <AuthPage onCreateLocal={createLocalProfile} onEnterDemo={enterDemo} />;
  }

  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardApp onSignOut={signOut} session={session} />
    </Suspense>
  );
}
