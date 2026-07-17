import { AppNavigation } from "@/components/app-navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAppUser } from "@/lib/auth";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireAppUser();

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1440px] lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-b border-black/10 bg-white/45 px-4 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/3 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0 lg:px-5 lg:py-6">
        <div className="flex items-center justify-between lg:block">
          <div className="flex items-center gap-3 px-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-white shadow-sm">
              BC
            </span>
            <div>
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

        <div className="mt-4 hidden border-t border-black/8 pt-5 lg:block dark:border-white/8">
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
  );
}
