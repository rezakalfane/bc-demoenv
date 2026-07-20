"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationItems = [
  { href: "/", label: "Dashboard", icon: "D" },
  { href: "/snapshots", label: "Snapshots", icon: "S" },
  { href: "/operations", label: "Operations", icon: "O" },
  { href: "/notes", label: "Notes", icon: "N" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function AppNavigation() {
  const pathname = usePathname();
  const compact = pathname === "/operations" || pathname.startsWith("/operations/");

  return (
    <nav aria-label="Main navigation" className="space-y-1">
      {navigationItems.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/" || pathname.startsWith("/environments/")
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            title={compact ? item.label : undefined}
            aria-label={compact ? item.label : undefined}
            aria-current={isActive ? "page" : undefined}
            className={`app-nav-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              isActive
                ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300"
                : "text-black/50 hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex size-7 items-center justify-center rounded-lg text-xs font-semibold ${
                isActive
                  ? "bg-emerald-500 text-white"
                  : "bg-black/5 dark:bg-white/8"
              }`}
            >
              {item.icon}
            </span>
            <span className="app-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
