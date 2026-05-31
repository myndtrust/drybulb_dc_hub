import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Variant = "finding" | "verify" | "insight";

interface CalloutProps {
  variant?: Variant;
  title?: string;
  children: ReactNode;
}

const config: Record<Variant, { label: string; bar: string; bg: string }> = {
  finding: {
    label: "Key finding",
    bar: "border-l-foreground/40",
    bg: "bg-muted/40 border border-border/60",
  },
  verify: {
    label: "Verify before publishing",
    bar: "border-l-amber-500/70",
    bg: "bg-amber-50/60 border border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-800/40",
  },
  insight: {
    label: "Insight",
    bar: "border-l-foreground/25",
    bg: "bg-muted/20 border border-border/40",
  },
};

export function Callout({ variant = "insight", title, children }: CalloutProps) {
  const { label, bar, bg } = config[variant];
  const displayTitle = title ?? label;

  return (
    <div
      className={cn(
        "not-prose my-8 rounded-r-md border-l-4 px-5 py-4",
        bar,
        bg
      )}
    >
      <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground mb-3">
        {displayTitle}
      </p>
      <div
        className={cn(
          "text-sm leading-relaxed text-foreground/80",
          "[&_p]:mb-2 [&_p:last-child]:mb-0",
          "[&_strong]:font-semibold [&_strong]:text-foreground",
          "[&_em]:italic",
          "[&_ul]:mt-2 [&_ul]:space-y-1.5 [&_ul]:pl-4",
          "[&_li]:list-disc [&_li]:marker:text-foreground/30",
          "[&_code]:font-mono [&_code]:text-xs [&_code]:bg-background/60 [&_code]:px-1 [&_code]:rounded"
        )}
      >
        {children}
      </div>
    </div>
  );
}
