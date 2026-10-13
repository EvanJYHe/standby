import { cn } from "../lib/cn.js";
import { Mark } from "./Lockup.js";
import { container, DownloadLink, whiteButton } from "./ui.js";

export function ClosingCta() {
  return (
    <section aria-labelledby="closing-title" className="sb-on-blue mt-[88px] bg-sb-blue text-white md:mt-32">
      <div className={cn(container, "flex min-h-[440px] flex-col items-center justify-center py-[88px] md:min-h-[520px]")}>
        <div className="sb-reveal flex flex-col items-center text-center">
          <Mark color="white" height={56} sequenced />
          <h2
            className="mt-8 font-sb-serif text-[clamp(44px,5.5vw,80px)] font-normal leading-[1] tracking-[-0.02em] [text-wrap:balance]"
            id="closing-title"
          >
            Never let a good slot go quiet.
          </h2>
          <DownloadLink className={cn(whiteButton, "mt-10")}>Download for Mac</DownloadLink>
        </div>
      </div>
    </section>
  );
}
