import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/cn.js";
import { XIcon } from "./icons.js";

export { cn } from "../lib/cn.js";

const buttonVariants = {
  primary: "border-standby bg-standby text-ink shadow-[0_6px_14px_rgba(145,58,42,0.14)] hover:border-[#ff8168] hover:bg-[#ff8168]",
  secondary: "border-line bg-panel text-ink hover:border-[#c8c7c0] hover:bg-white",
  ghost: "border-transparent bg-transparent text-muted hover:bg-[#eeece6] hover:text-ink",
  danger: "border-[#e8c5bd] bg-white text-[#a74836] hover:bg-[#fff5f2]",
} as const;

export function Button({
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }) {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-standby border px-4 text-sm font-semibold transition-[color,background-color,border-color,transform,box-shadow] hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
        buttonVariants[variant],
        className,
      )}
      type="button"
      {...props}
    />
  );
}

export function IconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-standby border border-transparent text-muted transition-colors hover:bg-[#eeece6] hover:text-ink",
        className,
      )}
      type="button"
      {...props}
    />
  );
}

export function EmptyState({ icon, title, detail, action }: {
  icon?: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
      {icon === undefined ? null : <div className="mb-4 text-muted">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-6 text-muted">{detail}</p>
      {action === undefined ? null : <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div aria-label={label} className="inline-flex rounded-standby border border-line bg-[#f1efe9] p-1" role="group">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={cn(
            "h-8 rounded-[7px] px-3.5 text-sm font-medium transition-[color,background-color,box-shadow]",
            value === option.value
              ? "bg-ink text-white shadow-[0_4px_10px_rgba(16,23,34,0.14)]"
              : "text-muted hover:bg-white hover:text-ink",
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Drawer({ title, children, onClose }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[#101722]/25 backdrop-blur-[2px]" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }} role="presentation">
      <aside aria-label={title} aria-modal="true" className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-panel shadow-[-18px_0_50px_rgba(16,23,34,0.12)]" role="dialog">
        <div className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-line bg-panel px-6">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton aria-label={`Close ${title}`} onClick={onClose}><XIcon /></IconButton>
        </div>
        <div className="p-5">{children}</div>
      </aside>
    </div>
  );
}

export function Modal({ title, children, onClose }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#101722]/25 px-4 backdrop-blur-[2px]" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }} role="presentation">
      <section aria-label={title} aria-modal="true" className="modal-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[14px] border border-line bg-panel shadow-[0_28px_80px_rgba(16,23,34,0.22)]" role="dialog">
        <div className="flex h-[72px] items-center justify-between border-b border-line px-6">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton aria-label={`Close ${title}`} onClick={onClose}><XIcon /></IconButton>
        </div>
        <div className="p-5">{children}</div>
      </section>
    </div>
  );
}
