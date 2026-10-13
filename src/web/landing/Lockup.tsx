import type { CSSProperties } from "react";

import { cn } from "../lib/cn.js";

// Path data copied verbatim from public/landing/v2/standby-mark*.svg (the film's exact geometry).
const arcs = [
  "M0.6543 -0.97A1.17 1.17 0 0 1 1.1682 -0.0653L0.8287 -0.0463A0.83 0.83 0 0 0 0.4641 -0.6881Z",
  "M1.1674 0.0775A1.17 1.17 0 0 1 0.6441 0.9768L0.4569 0.6929A0.83 0.83 0 0 0 0.8282 0.055Z",
  "M0.5202 1.048A1.17 1.17 0 0 1 -0.5202 1.048L-0.369 0.7434A0.83 0.83 0 0 0 0.369 0.7434Z",
  "M-0.6441 0.9768A1.17 1.17 0 0 1 -1.1674 0.0775L-0.8282 0.055A0.83 0.83 0 0 0 -0.4569 0.6929Z",
  "M-1.1682 -0.0653A1.17 1.17 0 0 1 -0.6543 -0.97L-0.4641 -0.6881A0.83 0.83 0 0 0 -0.8287 -0.0463Z",
] as const;

const fills = { blue: "#0867f5", white: "#ffffff", ink: "#0b1220" } as const;

export function Mark({
  color,
  height,
  sequenced = false,
  className,
  style,
}: {
  color: keyof typeof fills;
  height: number;
  sequenced?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const part = (index: number) =>
    sequenced ? { className: "sb-mark-part", style: { "--sb-part": index } as CSSProperties } : {};

  return (
    <svg
      aria-hidden="true"
      className={cn("block shrink-0", className)}
      fill={fills[color]}
      focusable="false"
      height={height}
      style={style}
      viewBox="-1.17 -1.29 2.34 2.46"
      width={(height * 2.34) / 2.46}
    >
      {arcs.map((d, index) => (
        <path d={d} key={d} {...part(index)} />
      ))}
      <rect height="1.23" width="0.34" x="-0.17" y="-1.29" {...part(arcs.length)} />
    </svg>
  );
}

export function Lockup({ variant, size }: { variant: "white" | "color"; size: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold leading-none tracking-[-0.03em]",
        variant === "white" ? "text-white" : "text-sb-ink",
      )}
      style={{ gap: size * 0.45, fontSize: size * 1.15 }}
    >
      <Mark color={variant === "white" ? "white" : "blue"} height={size} />
      <span>Standby</span>
    </span>
  );
}
