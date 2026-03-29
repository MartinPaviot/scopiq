"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartBar, Target, Gear, SignOut, ClockCounterClockwise, Wrench,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth-client";

const NAV_ITEMS = [
  { href: "/market", label: "Market", icon: ChartBar },
  { href: "/icp", label: "ICP", icon: Target },
  { href: "/changelog", label: "Changelog", icon: ClockCounterClockwise },
  { href: "/setup", label: "Setup", icon: Wrench },
  { href: "/settings", label: "Settings", icon: Gear },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col w-14 lg:w-52 border-r bg-sidebar shrink-0 h-screen sticky top-0">
      {/* Logo */}
      <Link href="/market" className="flex items-center gap-2.5 px-3 h-14 border-b group">
        <div className="size-8 rounded-lg overflow-hidden shrink-0">
          <img src="/icon.svg" alt="Scopiq" className="size-8" />
        </div>
        <span className="hidden lg:block text-sm font-heading font-bold text-sidebar-foreground group-hover:text-primary transition-colors">
          Scopiq
        </span>
      </Link>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/settings" && pathname.startsWith(href + "/"));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-[18px] shrink-0" weight={active ? "fill" : "regular"} />
              <span className="hidden lg:block">{label}</span>
              {active && (
                <div className="hidden lg:block ml-auto size-1.5 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 pb-4 border-t pt-2">
        <button
          onClick={async () => {
            await signOut();
            window.location.href = "/login";
          }}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all w-full cursor-pointer"
        >
          <SignOut className="size-[18px] shrink-0" />
          <span className="hidden lg:block">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
