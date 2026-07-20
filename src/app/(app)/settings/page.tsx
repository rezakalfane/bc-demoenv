import {
  DeleteEnvironmentForm,
  EnvironmentForm,
} from "@/components/environment-form";
import { EnvironmentAccessDiagnostics } from "@/components/environment-access-diagnostics";
import { requireAppUser } from "@/lib/auth";
import {
  getBigCommerceEnvironments,
  getEnvironmentFavoriteKey,
  getFavoriteResourceKeys,
  type BigCommerceEnvironment,
} from "@/lib/db";
import { FavoriteButton } from "@/components/favorite-button";
import { CollectionBrowser } from "@/components/collection-browser";

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
  const [environments, favoriteKeys] = await Promise.all([
    getBigCommerceEnvironments(user.id),
    getFavoriteResourceKeys(user.id, "environment"),
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
        <header className="mb-8 border-b border-black/10 pb-7 dark:border-white/10">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            Settings
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            BigCommerce environments
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-black/55 dark:text-white/55">
            Save the stores you use for demos and development. Every environment
            belongs to your signed-in account; access tokens are encrypted before
            they reach the database.
          </p>
        </header>

        <section
          aria-labelledby="add-environment-heading"
          className="rounded-3xl border border-black/10 bg-white/65 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.05)] backdrop-blur sm:p-7 dark:border-white/10 dark:bg-white/4"
        >
          <h2
            id="add-environment-heading"
            className="text-lg font-semibold tracking-tight"
          >
            Add an environment
          </h2>
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
      </div>
    </div>
  );
}
