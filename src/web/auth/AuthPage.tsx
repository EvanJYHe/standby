import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Laptop } from "lucide-react";

export interface LocalProfileInput {
  name: string;
  email: string;
}

export interface AuthPageProps {
  onCreateLocal: (profile: LocalProfileInput) => void;
  onEnterDemo: () => void;
}

function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5 text-[18px] font-semibold tracking-[-0.035em]">
      <span className="h-10 w-10 overflow-hidden rounded-[9px]">
        <img
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover"
          decoding="async"
          fetchPriority="high"
          height="192"
          src="/landing/standby-mark.webp"
          width="192"
        />
      </span>
      Standby
    </span>
  );
}

export function AuthPage({ onCreateLocal, onEnterDemo }: AuthPageProps) {
  const [submitting, setSubmitting] = useState<"profile" | "demo">();
  const [profileError, setProfileError] = useState<string>();
  const [demoError, setDemoError] = useState<string>();

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();

    if (name === "" || email === "") return;

    setSubmitting("profile");
    setProfileError(undefined);
    try {
      await onCreateLocal({ name, email });
    } catch {
      setProfileError("That local profile could not be opened. Please try again.");
      setSubmitting(undefined);
    }
  };

  const handleDemo = async () => {
    setSubmitting("demo");
    setDemoError(undefined);
    try {
      await onEnterDemo();
    } catch {
      setDemoError("The demo workspace could not be opened. Please try again.");
      setSubmitting(undefined);
    }
  };

  const busy = submitting !== undefined;

  return (
    <div className="landing-page min-h-[100svh] bg-landing-paper font-landing-sans text-landing-ink selection:bg-landing-ink selection:text-white">
      <header className="mx-auto flex h-20 w-[calc(100%_-_40px)] max-w-[1240px] items-center justify-between max-[600px]:h-[72px] max-[600px]:w-[calc(100%_-_32px)]">
        <a aria-label="Standby home" className="rounded-[9px] focus-visible:outline-offset-4" href="/">
          <Brand />
        </a>
        <a
          className="inline-flex min-h-10 items-center gap-2 rounded-[8px] px-3 text-[12px] font-bold uppercase tracking-[0.08em] text-landing-muted transition-colors hover:bg-white/60 hover:text-landing-ink"
          href="/"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          <span className="max-[420px]:hidden">Back to site</span>
        </a>
      </header>

      <main className="mx-auto grid min-h-[calc(100svh_-_80px)] w-[calc(100%_-_40px)] max-w-[1240px] grid-cols-[minmax(0,1fr)_460px] items-center gap-[72px] pb-16 max-[900px]:min-h-0 max-[900px]:max-w-[560px] max-[900px]:grid-cols-1 max-[900px]:gap-9 max-[900px]:pb-12 max-[600px]:w-[calc(100%_-_32px)] max-[600px]:pb-8">
        <section className="pb-4 max-[900px]:pt-8 max-[600px]:pt-5" aria-labelledby="access-heading">
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.18em] text-landing-muted">
            Standby workspace
          </p>
          <h1
            className="mb-0 mt-5 max-w-[720px] text-[clamp(58px,6.3vw,88px)] font-normal leading-[0.9] tracking-[-0.068em] max-[600px]:text-[clamp(49px,14vw,67px)]"
            id="access-heading"
          >
            Your calendar,
            <em className="block font-landing-serif font-normal">still in motion.</em>
          </h1>
          <p className="mb-0 mt-6 max-w-[590px] text-[17px] leading-[1.6] tracking-[-0.01em] text-landing-muted max-[600px]:text-[15px]">
            Create a profile for this browser, or look around the sample workspace first.
          </p>
          <div className="mt-10 max-w-[640px] rounded-[14px] border border-[rgba(16,23,34,0.1)] bg-landing-panel p-6 shadow-[0_18px_50px_rgba(16,23,34,0.08)] max-[600px]:mt-8 max-[600px]:rounded-[10px] max-[600px]:p-5">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-landing-muted">
              Demo workspace
            </p>
            <div className="mt-3 flex items-end justify-between gap-6 max-[600px]:flex-col max-[600px]:items-stretch max-[600px]:gap-5">
              <div>
                <h2 className="m-0 text-[22px] font-semibold tracking-[-0.035em]">
                  Want to look around first?
                </h2>
                <p className="mb-0 mt-1.5 text-[13px] leading-[1.5] text-landing-muted">
                  Sample calendar and customers. No real calls.
                </p>
              </div>
              <button
                className="inline-flex h-11 flex-none items-center justify-center gap-2 rounded-[8px] border border-landing-coral bg-landing-coral px-5 text-[11px] font-bold uppercase tracking-[0.08em] text-landing-ink transition-colors hover:bg-[#ff8168] disabled:cursor-wait disabled:opacity-60"
                disabled={busy}
                onClick={() => void handleDemo()}
                type="button"
              >
                {submitting === "demo" ? "Opening demo…" : "Enter demo"}
                {submitting === "demo" ? null : <ArrowRight aria-hidden="true" className="h-4 w-4" />}
              </button>
            </div>
            {demoError === undefined ? null : (
              <p aria-live="polite" className="mb-0 mt-4 rounded-[8px] bg-[#fff1ed] px-3 py-2.5 text-[12px] leading-5 text-[#9f402f]" role="alert">
                {demoError}
              </p>
            )}
          </div>
        </section>

        <section
          aria-labelledby="profile-heading"
          className="rounded-[14px] border border-[rgba(16,23,34,0.1)] bg-landing-panel p-9 shadow-[0_18px_50px_rgba(16,23,34,0.08)] max-[600px]:rounded-[10px] max-[600px]:p-5"
        >
          <h2 className="m-0 text-[34px] font-semibold leading-tight tracking-[-0.05em]" id="profile-heading">
            Welcome to Standby.
          </h2>
          <p className="mb-7 mt-2.5 text-[14px] leading-[1.55] text-landing-muted">
            Create a local profile to personalize this demo on your device.
          </p>

          <form className="grid gap-4" onSubmit={handleProfileSubmit}>
            <label className="grid gap-2 text-[12px] font-semibold" htmlFor="standby-profile-name">
              Your name
              <input
                autoComplete="name"
                className="h-12 rounded-[8px] border border-[rgba(16,23,34,0.16)] bg-white px-3.5 text-[15px] font-normal text-landing-ink placeholder:text-[#9aa0a8] focus:border-landing-coral focus:outline-none focus:ring-[3px] focus:ring-[rgba(243,111,86,0.14)]"
                disabled={busy}
                id="standby-profile-name"
                name="name"
                placeholder="Alex Morgan"
                required
                type="text"
              />
            </label>
            <label className="grid gap-2 text-[12px] font-semibold" htmlFor="standby-profile-email">
              Email address
              <input
                autoComplete="email"
                className="h-12 rounded-[8px] border border-[rgba(16,23,34,0.16)] bg-white px-3.5 text-[15px] font-normal text-landing-ink placeholder:text-[#9aa0a8] focus:border-landing-coral focus:outline-none focus:ring-[3px] focus:ring-[rgba(243,111,86,0.14)]"
                disabled={busy}
                id="standby-profile-email"
                inputMode="email"
                name="email"
                placeholder="you@example.com"
                required
                type="email"
              />
            </label>
            <button
              className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-landing-ink bg-landing-ink px-5 text-[12px] font-bold uppercase tracking-[0.08em] text-white transition-[background-color,transform,box-shadow] hover:-translate-y-0.5 hover:bg-[#26303d] hover:shadow-[0_8px_18px_rgba(16,23,34,0.14)] disabled:cursor-wait disabled:translate-y-0 disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              {submitting === "profile" ? "Opening profile…" : "Create local profile"}
              {submitting === "profile" ? null : <ArrowRight aria-hidden="true" className="h-4 w-4" />}
            </button>
          </form>

          <p className="mt-3 flex items-start gap-2 text-[11px] leading-[1.5] text-landing-muted">
            <Laptop aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <span>Stored only in this browser. No online account is created and no email is sent.</span>
          </p>

          {profileError === undefined ? null : (
            <p aria-live="polite" className="mt-4 rounded-[8px] bg-[#fff1ed] px-3 py-2.5 text-[12px] leading-5 text-[#9f402f]" role="alert">
              {profileError}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
