"use client";

import { usePathname } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { saveCollectionSidebarCollapsed } from "@/app/(app)/collection-preference-actions";
import { AppNavigation } from "@/components/app-navigation";
import { CatalogOperationNotifications } from "@/components/catalog-operation-notifications";
import { useCollectionPreference } from "@/components/collection-preferences-provider";
import { SignOutButton } from "@/components/sign-out-button";

function pagePreferenceId(pathname: string) {
  if (pathname === "/operations" || pathname.startsWith("/operations/")) return "operations-page";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "settings-environments";
  if (pathname === "/notes" || pathname.startsWith("/notes/")) return "notes-page";
  if (/^\/snapshots\/[^/]+/.test(pathname)) return "snapshot-products";
  if (pathname === "/snapshots") return "snapshot-series";
  if (/^\/environments\/[^/]+\/channels\/[^/]+/.test(pathname)) return "channel-products";
  if (/^\/environments\/[^/]+/.test(pathname)) return "environment-channels";
  return "dashboard-environments";
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={collapsed ? "m7 4 6 6-6 6" : "m13 4-6 6 6 6"} />
    </svg>
  );
}

export function AppShell({
  userId,
  userEmail,
  children,
}: {
  userId: string;
  userEmail: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const preferenceId = pagePreferenceId(pathname);
  const { preference } = useCollectionPreference(preferenceId);
  const {
    preference: shellPreference,
    updatePreference: updateShellPreference,
  } = useCollectionPreference("app-shell");
  const [, startTransition] = useTransition();
  const collapsed = shellPreference.sidebarCollapsed;

  function toggleSidebar() {
    const nextCollapsed = !collapsed;
    updateShellPreference("app-shell", { sidebarCollapsed: nextCollapsed });
    startTransition(async () => {
      await saveCollectionSidebarCollapsed("app-shell", nextCollapsed);
    });
  }

  return (
    <div
      data-sidebar-collapsed={collapsed ? "true" : "false"}
      data-page-view-mode={preference.viewMode}
      className="app-shell mx-auto min-h-screen w-full max-w-[1440px] lg:grid lg:grid-cols-[260px_minmax(0,1fr)]"
    >
      <aside className="app-sidebar relative border-b border-black/10 bg-white/45 px-4 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/3 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0 lg:px-5 lg:py-6">
        <button
          type="button"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={toggleSidebar}
          className="app-sidebar-toggle absolute top-7 -right-3 z-20 hidden size-6 items-center justify-center rounded-full border border-black/10 bg-background text-black/45 shadow-sm transition hover:border-emerald-500/35 hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 lg:flex dark:border-white/10 dark:text-white/45 dark:hover:text-emerald-300"
        >
          <CollapseIcon collapsed={collapsed} />
        </button>

        <div className="app-sidebar-header flex items-center justify-between gap-3">
          <div className="app-brand flex items-center gap-3 px-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-white shadow-sm">BC</span>
            <div className="app-brand-copy">
              <p className="text-sm font-semibold tracking-tight">Demo Env</p>
              <p className="text-xs text-black/40 dark:text-white/40">BigCommerce tools</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CatalogOperationNotifications userId={userId} />
            <div className="lg:hidden"><SignOutButton /></div>
          </div>
        </div>

        <div className="mt-4 lg:mt-8 lg:flex-1">
          <AppNavigation compact={collapsed} />
        </div>

        <div className="app-sidebar-footer mt-4 hidden border-t border-black/8 pt-5 lg:block dark:border-white/8">
          <p className="truncate px-2 text-xs text-black/45 dark:text-white/45">{userEmail}</p>
          <div className="mt-3 px-2"><SignOutButton /></div>
        </div>
      </aside>

      <main className="min-w-0">{children}</main>
    </div>
  );
}
