import Link from "next/link";
import { notFound } from "next/navigation";
import { getEnvironmentDetails } from "@/lib/bigcommerce";
import { CatalogActivityBadge } from "@/components/catalog-operation-progress";

export const dynamic = "force-dynamic";

function formatChannelMetadata(values: string[]) {
  return values.filter(Boolean).join(" · ");
}

function ChannelUrl({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-w-0 items-center justify-between gap-4 rounded-xl border border-black/8 bg-black/2.5 px-3.5 py-3 text-sm transition hover:border-emerald-500/40 hover:bg-emerald-500/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-white/8 dark:bg-white/3 dark:hover:border-emerald-400/40 dark:hover:bg-emerald-400/6"
    >
      <span className="truncate text-black/65 group-hover:text-emerald-800 dark:text-white/65 dark:group-hover:text-emerald-300">
        {url}
      </span>
      <span aria-hidden="true" className="shrink-0 text-black/35 dark:text-white/35">
        ↗
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export default async function EnvironmentPage({
  params,
}: {
  params: Promise<{ environmentId: string }>;
}) {
  const { environmentId } = await params;
  const id = Number(environmentId);

  if (!Number.isSafeInteger(id) || id < 1) {
    notFound();
  }

  const environment = await getEnvironmentDetails(id);

  if (!environment) {
    notFound();
  }

  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mx-auto w-full max-w-5xl">
        <Link
          href="/"
          className="inline-flex rounded-sm text-sm font-medium text-black/45 transition hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:text-white/45 dark:hover:text-emerald-300"
        >
          ← Dashboard
        </Link>

        <header className="mt-7 border-b border-black/10 pb-7 dark:border-white/10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Environment
              </p>
              <h1 className="mt-2 truncate text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                <span className="inline-flex items-center gap-3">{environment.name}<CatalogActivityBadge environmentId={environment.id} /></span>
              </h1>
              <p className="mt-3 font-mono text-xs text-black/40 dark:text-white/40">
                {environment.storeHash}
              </p>
            </div>
            <span className="w-fit shrink-0 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-black/50 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-white/50">
              {environment.channels.length}{" "}
              {environment.channels.length === 1 ? "channel" : "channels"}
            </span>
          </div>
        </header>

        {environment.error ? (
          <div
            role="alert"
            className="mt-7 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-5 text-sm text-amber-800 dark:text-amber-200"
          >
            <p>{environment.error}</p>
            <Link
              href="/settings"
              className="mt-3 inline-flex font-semibold underline decoration-amber-500/40 underline-offset-4 hover:decoration-current"
            >
              Review this environment in Settings
            </Link>
          </div>
        ) : environment.channels.length === 0 ? (
          <div className="mt-7 rounded-3xl border border-dashed border-black/15 px-6 py-14 text-center dark:border-white/15">
            <p className="font-medium">No channels were found.</p>
            <p className="mt-1 text-sm text-black/45 dark:text-white/45">
              This BigCommerce environment does not currently return any channels.
            </p>
          </div>
        ) : (
          <section className="mt-7" aria-labelledby="channels-heading">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2
                id="channels-heading"
                className="text-lg font-semibold tracking-tight"
              >
                Channels
              </h2>
              <p className="text-xs text-black/40 dark:text-white/40">
                Storefront links open in a new tab
              </p>
            </div>

            <div className="space-y-4">
              {environment.channels.map((channel) => {
                const metadata = formatChannelMetadata([
                  channel.type,
                  channel.platform,
                  channel.status,
                ]);

                return (
                  <article
                    key={channel.id}
                    className="rounded-2xl border border-black/10 bg-white/70 p-5 shadow-[0_12px_35px_rgba(0,0,0,0.035)] backdrop-blur dark:border-white/10 dark:bg-white/4"
                  >
                    <h3 className="font-semibold tracking-tight">
                      <Link
                        href={`/environments/${environment.id}/channels/${channel.id}`}
                        className="rounded-sm transition hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:hover:text-emerald-300"
                      >
                        <span className="inline-flex items-center gap-3">{channel.name}<CatalogActivityBadge environmentId={environment.id} channelId={channel.id} /></span>
                      </Link>
                    </h3>
                    {metadata ? (
                      <p className="mt-1 text-xs capitalize text-black/40 dark:text-white/40">
                        {metadata}
                      </p>
                    ) : null}

                    {channel.urls.length > 0 ? (
                      <div className="mt-4 grid gap-2 lg:grid-cols-2">
                        {channel.urls.map((url) => (
                          <ChannelUrl key={url} url={url} />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-black/40 dark:text-white/40">
                        {channel.urlError ??
                          "No storefront URL is available for this channel."}
                      </p>
                    )}

                    <Link
                      href={`/environments/${environment.id}/channels/${channel.id}`}
                      className="mt-4 inline-flex rounded-sm text-xs font-semibold text-emerald-700 transition hover:text-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:text-emerald-300 dark:hover:text-emerald-200"
                    >
                      View catalog →
                    </Link>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
