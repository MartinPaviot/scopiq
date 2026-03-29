"use client";

import { TRPCProvider } from "@/components/trpc-provider";
import { AppSidebar } from "@/components/app-sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TRPCProvider>
      <div className="flex min-h-screen">
        <AppSidebar />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </TRPCProvider>
  );
}
