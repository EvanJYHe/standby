import { cn } from "../lib/cn.js";
import { Lockup } from "./Lockup.js";
import { container } from "./ui.js";

const footerLink = "rounded-sm transition-colors duration-150 hover:text-sb-blue";

export function Footer() {
  return (
    <footer className={cn(container, "flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between")}>
      <Lockup size={20} variant="color" />
      <nav aria-label="Footer" className="flex items-center gap-6 text-[14px] text-sb-ink-2">
        <a className={footerLink} href="https://github.com/EvanJYHe/standby" rel="noreferrer" target="_blank">
          GitHub
        </a>
        <a className={footerLink} href="https://www.evanhe.co/" rel="noreferrer" target="_blank">
          Built by Evan He
        </a>
      </nav>
    </footer>
  );
}
