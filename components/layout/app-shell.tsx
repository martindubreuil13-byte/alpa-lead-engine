"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  KanbanSquare,
  Search,
  FileText,
  Settings
} from "lucide-react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Layers },
  { href: "/kanban", label: "Kanban", icon: KanbanSquare },
  { href: "/scraper", label: "Scraper", icon: Search },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-7xl gap-8 px-6 py-8 lg:py-10">
        <aside className="hidden w-60 shrink-0 rounded-3xl border border-white/80 bg-white/80 p-6 shadow-soft lg:block">
          <div className="mb-8">
            <p className="text-xs uppercase tracking-[0.2em] text-slate/60">Quebec Outreach</p>
            <h1 className="text-xl font-semibold text-slate">Outreach Desk</h1>
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium transition",
                    active
                      ? "bg-slate text-white shadow"
                      : "text-slate/70 hover:bg-slate/5"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-10">
            <Button variant="outline" className="w-full" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </aside>
        <main className="w-full space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/80 bg-white/80 p-4 shadow-soft lg:hidden">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate/60">Quebec Outreach</p>
              <p className="text-sm font-semibold text-slate">Outreach Desk</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {navItems.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold",
                      active ? "bg-slate text-white" : "bg-slate/5 text-slate"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
