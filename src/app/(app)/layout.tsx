import { AppNavigation } from "@/components/app-navigation";
import { CatalogOperationNotifications } from "@/components/catalog-operation-notifications";
import { CollectionPreferencesProvider } from "@/components/collection-preferences-provider";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAppUser } from "@/lib/auth";
import { getCollectionViewPreferences } from "@/lib/db";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireAppUser();
  const collectionPreferences = await getCollectionViewPreferences(user.id);

  return (
    <CollectionPreferencesProvider initialPreferences={collectionPreferences}>
      <div className="app-shell mx-auto min-h-screen w-full max-w-[1440px] lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
        <CatalogOperationNotifications userId={user.id} />
        <aside className="app-sidebar border-b border-black/10 bg-white/45 px-4 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/3 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0 lg:px-5 lg:py-6">
        <div className="flex items-center justify-between lg:block">
          <div className="app-brand flex items-center gap-3 px-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-white shadow-sm">
              BC
            </span>
            <div className="app-brand-copy">
              <p className="text-sm font-semibold tracking-tight">Demo Env</p>
              <p className="text-xs text-black/40 dark:text-white/40">
                BigCommerce tools
              </p>
            </div>
          </div>
          <div className="lg:hidden">
            <SignOutButton />
          </div>
        </div>

        <div className="mt-4 lg:mt-8 lg:flex-1">
          <AppNavigation />
        </div>

        <div className="app-sidebar-footer mt-4 hidden border-t border-black/8 pt-5 lg:block dark:border-white/8">
          <p className="truncate px-2 text-xs text-black/45 dark:text-white/45">
            {user.email}
          </p>
          <div className="mt-3 px-2">
            <SignOutButton />
          </div>
        </div>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </CollectionPreferencesProvider>
  );
}
