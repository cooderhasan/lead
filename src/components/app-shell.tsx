"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  Building2,
  Factory,
  FileBarChart,
  FileText,
  KanbanSquare,
  LayoutDashboard,
  LineChart,
  ListChecks,
  Mail,
  Megaphone,
  Menu,
  Package,
  Radar,
  Settings,
  Sparkles,
  Swords,
  X,
  type LucideIcon,
} from "lucide-react";
import { NAV_ITEMS, type NavIcon } from "./nav";
import { cn } from "@/lib/cn";

const ICONS: Record<NavIcon, LucideIcon> = {
  FileText,
  LayoutDashboard,
  Sparkles,
  Building2,
  Megaphone,
  KanbanSquare,
  ListChecks,
  Mail,
  Factory,
  Package,
  BookOpen,
  Swords,
  Radar,
  LineChart,
  FileBarChart,
  Settings,
};

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Ana menü">
      {NAV_ITEMS.map((item) => {
        const Icon = ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
              active ? "bg-accent-soft font-medium text-accent-text" : "text-text-2 hover:bg-surface-2 hover:text-text",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate">{item.label}</span>
            {item.phase > 1 && (
              <span className="rounded bg-surface-2 px-1.5 py-px text-[10px] font-medium text-text-3 group-hover:bg-surface">
                Faz {item.phase}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ topbar, footer, children }: { topbar: ReactNode; footer: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2 px-2.5 text-sm font-semibold text-text">
      <span className="grid size-7 place-items-center rounded-lg bg-accent text-white">
        <Sparkles className="size-4" aria-hidden />
      </span>
      AI Sales OS
    </Link>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Masaüstü kenar çubuğu */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 border-r border-border bg-surface px-3 py-4 lg:flex">
        {brand}
        <div className="flex-1 overflow-y-auto">
          <NavList />
        </div>
        {footer}
      </aside>

      {/* Mobil çekmece */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menü">
          <button className="absolute inset-0 bg-black/40" aria-label="Menüyü kapat" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 bg-surface px-3 py-4 shadow-xl">
            <div className="flex items-center justify-between">
              {brand}
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-text-2 hover:bg-surface-2" aria-label="Kapat">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavList onNavigate={() => setOpen(false)} />
            </div>
            {footer}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
          <button
            onClick={() => setOpen(true)}
            className="-ml-1 rounded-lg p-2 text-text-2 hover:bg-surface-2 lg:hidden"
            aria-label="Menüyü aç"
          >
            <Menu className="size-5" />
          </button>
          {topbar}
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
