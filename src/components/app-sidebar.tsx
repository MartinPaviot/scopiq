"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartBar, Target, Gear, SignOut, ClockCounterClockwise } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth-client";

const NAV_ITEMS = [
  { href: "/market", label: "Market", icon: ChartBar },
  { href: "/icp", label: "ICP", icon: Target },
  { href: "/changelog", label: "Changelog", icon: ClockCounterClockwise },
  { href: "/settings", label: "Settings", icon: Gear },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col w-14 lg:w-48 border-r bg-sidebar shrink-0 h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-3 h-12 border-b">
        <div className="size-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
          S
        </div>
        <span className="hidden lg:block text-sm font-heading font-semibold text-sidebar-foreground">
          Scopiq
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 px-2 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" weight={active ? "fill" : "regular"} />
              <span className="hidden lg:block">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 pb-3">
        <button
          onClick={async () => { await signOut(); window.location.href = "/login"; }}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors w-full"
        >
          <SignOut className="size-4 shrink-0" />
          <span className="hidden lg:block">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
