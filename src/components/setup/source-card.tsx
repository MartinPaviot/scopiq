"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle, Spinner, WarningCircle } from "@phosphor-icons/react";

export type SourceStatus = "empty" | "loading" | "success" | "error";

interface SourceCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  status: SourceStatus;
  priority?: boolean;
  comingSoon?: boolean;
  errorMessage?: string;
  preview?: ReactNode;
  children: ReactNode;
}

export function SourceCard({
  title,
  description,
  icon,
  status,
  priority,
  comingSoon,
  errorMessage,
  preview,
  children,
}: SourceCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card p-5 transition-all",
        priority && "ring-2 ring-primary/20 border-primary/30",
        status === "success" && "border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10",
        status === "error" && "border-red-500/30",
        comingSoon && "opacity-60",
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={cn(
          "flex items-center justify-center size-9 rounded-lg shrink-0",
          status === "success" ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground",
        )}>
          {status === "success" ? <CheckCircle className="size-5" weight="fill" /> : icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {comingSoon && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                Coming soon
              </span>
            )}
            {status === "loading" && <Spinner className="size-3.5 animate-spin text-primary" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>

      {/* Content area */}
      {!comingSoon && (
        <div className="mt-2">
          {status === "success" && preview ? (
            <div className="animate-fade-in-up">{preview}</div>
          ) : status === "error" ? (
            <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 mb-2">
              <WarningCircle className="size-3.5 shrink-0" />
              <span>{errorMessage ?? "Something went wrong"}</span>
            </div>
          ) : null}
          {status !== "success" && children}
        </div>
      )}
    </div>
  );
}
