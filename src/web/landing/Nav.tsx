import { cn } from "../lib/cn.js";
import { Lockup } from "./Lockup.js";
import { container, DownloadLink, smallButton } from "./ui.js";

const navLink =
  "hidden rounded-sm text-[14px] font-medium text-white decoration-white/50 underline-offset-4 hover:underline md:inline";

export function Nav() {
  return (
    <header className="absolute inset-x-0 top-0 z-20 animate-sb-rise">
      <nav aria-label="Main" className={cn(container, "flex h-16 items-center justify-between")}>
        <a aria-label="Standby home" className="rounded-md" href="/">
          <Lockup size={22} variant="white" />
        </a>
        <div className="flex items-center gap-7">
          <a className={navLink} href="#how">
            How it works
          </a>
          <a className={navLink} href="https://github.com/EvanJYHe/standby" rel="noreferrer" target="_blank">
            GitHub
          </a>
          <DownloadLink className={smallButton}>Download</DownloadLink>
        </div>
      </nav>
    </header>
  );
}
