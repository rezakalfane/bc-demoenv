import {
  DeleteEnvironmentForm,
  EnvironmentForm,
} from "@/components/environment-form";
import { EnvironmentAccessDiagnostics } from "@/components/environment-access-diagnostics";
import { requireAppUser } from "@/lib/auth";
import {
  getBigCommerceEnvironments,
  getCollectionViewPreferences,
  getDevelopmentDatabaseStatus,
  getEnvironmentFavoriteKey,
  getFavoriteResourceKeys,
  getUserProfile,
  type BigCommerceEnvironment,
} from "@/lib/db";
import { FavoriteButton } from "@/components/favorite-button";
import { CollectionBrowser } from "@/components/collection-browser";
import { DevelopmentDatabasePanel } from "@/components/development-database-panel";
import { DatabaseBackupPanel } from "@/components/database-backup-panel";
import { LocalSchedulerSettings } from "@/components/local-scheduler-settings";
import { ProfileSettingsForm } from "@/components/profile-settings-form";
import { canMaintainDatabase } from "@/lib/database-maintenance-auth";

export const dynamic = "force-dynamic";

function SavedEnvironmentCard({
  environment,
  isFavorite,
}: {
  environment: BigCommerceEnvironment;
  isFavorite: boolean;
}) {
  return (
    <article className="flex h-full flex-col rounded-3xl border border-black/10 bg-white/65 p-5 shadow-[0_12px_40px_rgba(0,0,0,0.04)] backdrop-blur sm:p-6 dark:border-white/10 dark:bg-white/4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-semibold">{environment.name}</h3>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-black/40 dark:text-white/40">Store hash</dt>
              <dd className="mt-0.5 font-mono">{environment.storeHash}</dd>
            </div>
            <div>
              <dt className="text-xs text-black/40 dark:text-white/40">Access token</dt>
              <dd className="mt-0.5 font-mono">••••••••{environment.accessTokenHint}</dd>
            </div>
          </dl>
        </div>
        <div className="shrink-0">
          <FavoriteButton
            target={{ type: "environment", environmentId: environment.id }}
            initialFavorite={isFavorite}
            label={environment.name}
          />
        </div>
      </div>

      <EnvironmentAccessDiagnostics environment={environment} />

      <div className="mt-auto flex items-start justify-between gap-4 border-t border-black/8 pt-4 dark:border-white/8">
        <details className="group min-w-0 flex-1">
          <summary className="cursor-pointer list-none text-sm font-medium text-black/50 transition hover:text-black dark:text-white/50 dark:hover:text-white">
            <span className="group-open:hidden">Edit environment</span>
            <span className="hidden group-open:inline">Close editor</span>
          </summary>
          <div className="mt-5"><EnvironmentForm environment={environment} /></div>
        </details>
        <DeleteEnvironmentForm environment={environment} />
      </div>
    </article>
  );
}

export default async function SettingsPage() {
  const user = await requireAppUser();
  const databaseStatus = getDevelopmentDatabaseStatus();
  const [environments, favoriteKeys, profile, preferences] = await Promise.all([
    getBigCommerceEnvironments(user.id),
    getFavoriteResourceKeys(user.id, "environment"),
    getUserProfile(user.id, {
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.imageUrl,
      timezone: "UTC",
    }),
    getCollectionViewPreferences(user.id),
  ]);
  const sortedEnvironments = environments.toSorted((left, right) => {
    const favoriteOrder =
      Number(favoriteKeys.has(getEnvironmentFavoriteKey(right.id))) -
      Number(favoriteKeys.has(getEnvironmentFavoriteKey(left.id)));
    if (favoriteOrder !== 0) return favoriteOrder;
    const nameOrder = left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    });
    return nameOrder !== 0 ? nameOrder : left.id - right.id;
  });

  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mx-auto w-full max-w-7xl">
        <header className="mb-10 border-b border-black/10 pb-7 dark:border-white/10">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            Settings
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            Application settings
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-black/55 dark:text-white/55">
            Manage your profile, interface preferences, BigCommerce connections,
            and development-only services in one place.
          </p>
        </header>

        <section id="profile" aria-labelledby="profile-heading" className="scroll-mt-8">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
              Account
            </p>
            <h2 id="profile-heading" className="mt-2 text-2xl font-semibold tracking-tight">
              Profile & preferences
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-black/45 dark:text-white/45">
              Set your identity, timezone, and application-wide display defaults.
            </p>
          </div>
          <ProfileSettingsForm
            email={user.email}
            profile={profile}
            initialPreferences={{
              environments: preferences["dashboard-environments"]?.viewMode ?? "cards",
              channels: preferences["environment-channels"]?.viewMode ?? "cards",
              snapshots: preferences["snapshot-series"]?.viewMode ?? "cards",
              settings: preferences["settings-environments"]?.viewMode ?? "cards",
              showSharedSnapshots: preferences["snapshot-series"]?.showShared ?? true,
              sidebarCollapsed: preferences["app-shell"]?.sidebarCollapsed ?? false,
            }}
          />
        </section>

        <section
          id="scheduler"
          aria-labelledby="scheduler-heading"
          className="mt-14 scroll-mt-8 border-t border-black/10 pt-10 dark:border-white/10"
        >
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
              Automation
            </p>
            <h2 id="scheduler-heading" className="mt-2 text-2xl font-semibold tracking-tight">
              Scheduler
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-black/45 dark:text-white/45">
              Control how due schedules are discovered locally and understand the
              cloud dispatcher cadence used by this deployment.
            </p>
          </div>

          <div className="space-y-5">
            <section className="rounded-3xl border border-black/10 bg-white/65 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.04)] sm:p-7 dark:border-white/10 dark:bg-white/4">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">Vercel Cron</h3>
                    <span className="rounded-full bg-blue-500/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                      Cloud
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-black/45 dark:text-white/45">
                    Production checks due schedules once per day. This cadence is
                    deploy-time configuration and is compatible with Vercel Hobby.
                  </p>
                </div>
                <div className="grid min-w-48 gap-1 rounded-2xl border border-black/8 px-4 py-3 text-sm dark:border-white/8">
                  <span className="text-xs uppercase tracking-[0.14em] text-black/40 dark:text-white/40">Interval</span>
                  <span className="font-semibold">Once per day</span>
                </div>
              </div>
              <p className="mt-5 text-sm leading-6 text-black/45 dark:text-white/45">
                Vercel Pro and Enterprise can dispatch every minute by changing the
                cron expression in <code className="font-mono text-xs">vercel.json</code> to <code className="font-mono text-xs">* * * * *</code> and redeploying. Runtime profile settings cannot change a deployed Vercel Cron.
                {" "}
                <a
                  href="https://vercel.com/docs/cron-jobs/usage-and-pricing"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-emerald-700 hover:underline dark:text-emerald-300"
                >
                  View Vercel scheduling limits ↗
                </a>
              </p>
            </section>

            {process.env.NODE_ENV === "development" ? (
              <LocalSchedulerSettings
                initialEnabled={profile.localSchedulerEnabled}
                initialInterval={profile.localSchedulerInterval}
              />
            ) : null}
          </div>
        </section>

        <section
          id="environments"
          aria-labelledby="environments-heading"
          className="mt-14 scroll-mt-8 border-t border-black/10 pt-10 dark:border-white/10"
        >
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
              Connections
            </p>
            <h2 id="environments-heading" className="mt-2 text-2xl font-semibold tracking-tight">
              BigCommerce environments
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-black/45 dark:text-white/45">
              Save the stores you use for demos and development. Every environment
              belongs to your account; access tokens are encrypted before storage.
            </p>
          </div>

          <section
            aria-labelledby="add-environment-heading"
            className="rounded-3xl border border-black/10 bg-white/65 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.05)] backdrop-blur sm:p-7 dark:border-white/10 dark:bg-white/4"
          >
            <h3
              id="add-environment-heading"
              className="text-lg font-semibold tracking-tight"
            >
              Add an environment
            </h3>
            <p className="mt-1 mb-6 text-sm text-black/45 dark:text-white/45">
              Create a memorable name for a BigCommerce store connection.
            </p>
            <EnvironmentForm />
          </section>

          <section aria-labelledby="saved-environments-heading" className="mt-10">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2
                id="saved-environments-heading"
                className="text-xl font-semibold tracking-tight"
              >
                Saved environments
              </h2>
              <p className="mt-1 text-sm text-black/45 dark:text-white/45">
                {environments.length}{" "}
                {environments.length === 1 ? "environment" : "environments"}
              </p>
            </div>
          </div>

          {environments.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-black/15 px-6 py-12 text-center dark:border-white/15">
              <p className="font-medium">No environments saved yet.</p>
              <p className="mt-1 text-sm text-black/45 dark:text-white/45">
                Add your first store connection above.
              </p>
            </div>
          ) : (
            <CollectionBrowser
              collectionId="settings-environments"
              ariaLabel="Saved environments"
              searchPlaceholder="Search saved environments…"
              cardsClassName="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
              columns={[
                { key: "name", label: "Environment", className: "max-w-56" },
                { key: "hash", label: "Store hash" },
                { key: "token", label: "Access token" },
                { key: "diagnostics", label: "Diagnostics" },
                { key: "remove", label: "Remove", align: "right" },
                { key: "favorite", label: "Favorite", align: "right" },
              ]}
              items={sortedEnvironments.map((environment) => {
                const isFavorite = favoriteKeys.has(getEnvironmentFavoriteKey(environment.id));
                return {
                  id: String(environment.id),
                  searchText: `${environment.name} ${environment.storeHash} ${environment.accessTokenHint}`,
                  card: <SavedEnvironmentCard environment={environment} isFavorite={isFavorite} />,
                  cells: [
                    <span key="name" className="font-semibold">{environment.name}</span>,
                    <span key="hash" className="font-mono text-black/55 dark:text-white/55">{environment.storeHash}</span>,
                    <span key="token" className="font-mono text-black/55 dark:text-white/55">••••{environment.accessTokenHint}</span>,
                    <EnvironmentAccessDiagnostics key="diagnostics" environment={environment} compact />,
                    <div key="remove" className="flex justify-end"><DeleteEnvironmentForm environment={environment} /></div>,
                    <div key="favorite" className="flex justify-end"><FavoriteButton target={{ type: "environment", environmentId: environment.id }} initialFavorite={isFavorite} label={environment.name} /></div>,
                  ],
                };
              })}
            />
          )}
          </section>
        </section>

        <section
          id="database-backup"
          aria-labelledby="database-backup-heading"
          className="mt-14 scroll-mt-8 border-t border-black/10 pt-10 dark:border-white/10"
        >
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
              Data safety
            </p>
            <h2 id="database-backup-heading" className="mt-2 text-2xl font-semibold tracking-tight">
              Database backup & restore
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-black/45 dark:text-white/45">
              Back up or restore the database currently used by this application—local SQLite in development or Turso on Vercel.
            </p>
          </div>
          <DatabaseBackupPanel
            activeDatabase={databaseStatus.activeDatabase}
            authorized={canMaintainDatabase(user)}
          />
        </section>

        {process.env.NODE_ENV === "development" ? (
          <section
            id="development"
            aria-labelledby="development-heading"
            className="mt-14 scroll-mt-8 border-t border-black/10 pt-10 dark:border-white/10"
          >
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
                Development only
              </p>
              <h2 id="development-heading" className="mt-2 text-2xl font-semibold tracking-tight">
                Local database
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-black/45 dark:text-white/45">
                Explicitly synchronize your development database with Turso. These
                controls are never rendered in production.
              </p>
            </div>
            <DevelopmentDatabasePanel status={databaseStatus} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
