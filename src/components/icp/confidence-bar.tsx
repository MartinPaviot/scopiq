"use client";

import { cn } from "@/lib/utils";

interface ConfidenceBarProps {
  value: number; // 0.0 - 1.0
  label?: string;
}

export function ConfidenceBar({ value, label }: ConfidenceBarProps) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  const textColor =
    pct >= 70 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-red-600";
  const levelLabel =
    pct >= 70 ? "High" : pct >= 40 ? "Medium" : "Low";

  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[10px] text-muted-foreground w-12 shrink-0">{label}</span>}
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn("text-[10px] font-medium w-14 text-right shrink-0", textColor)}>
        {levelLabel} ({pct}%)
      </span>
    </div>
  );
}
