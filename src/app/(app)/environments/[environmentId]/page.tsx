import Link from "next/link";
import { notFound } from "next/navigation";
import { getEnvironmentDetails, type EnvironmentChannel } from "@/lib/bigcommerce";
import { CatalogActivityBadge } from "@/components/catalog-operation-progress";
import { FavoriteButton } from "@/components/favorite-button";
import { CollectionBrowser } from "@/components/collection-browser";
import { AppTranslatedText } from "@/components/app-i18n-provider";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
});

const platformLabels: Record<string, string> = {
  bigcommerce: "BigCommerce",
  catalyst: "Catalyst",
  custom: "Custom",
  next: "Next.js",
};

function formatLabel(value: string) {
  const normalizedValue = value.trim().toLowerCase();
  return (
    platformLabels[normalizedValue] ??
    normalizedValue.replaceAll("_", " ").replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    )
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

function statusClasses(status: string) {
  return status.toLowerCase() === "active"
    ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
    : "bg-amber-500/12 text-amber-700 dark:text-amber-300";
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

function ChannelStatus({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClasses(status)}`}>
      <AppTranslatedText message={formatLabel(status)} />
    </span>
  );
}

function ChannelCard({
  channel,
  environmentId,
}: {
  channel: EnvironmentChannel;
  environmentId: number;
}) {
  const catalogHref = `/environments/${environmentId}/channels/${channel.id}`;
  const modifiedDate = formatDate(channel.dateModified);
  const createdDate = formatDate(channel.dateCreated);
  const channelFacts: Array<[string, string | number]> = [
    ["Channel ID", channel.id],
    ["Site ID", channel.siteId ?? "—"],
    ["Merchant UI", channel.isVisible === null ? "Not reported" : channel.isVisible ? "Visible" : "Hidden"],
    ["Product listings", channel.isListableFromUi === null ? "Not reported" : channel.isListableFromUi ? "Available" : "Unavailable"],
  ];

  return (
    <article className="flex min-h-80 flex-col rounded-3xl border border-black/10 bg-white/70 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.05)] backdrop-blur sm:p-6 dark:border-white/10 dark:bg-white/4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold tracking-tight">
            <Link href={catalogHref} className="rounded-sm transition hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:hover:text-emerald-300">
              <span className="inline-flex items-center gap-2">
                <span className="line-clamp-2">{channel.name}</span>
                <CatalogActivityBadge environmentId={environmentId} channelId={channel.id} />
              </span>
            </Link>
          </h3>
          <p className="mt-1 text-xs text-black/40 dark:text-white/40">{formatLabel(channel.type)} · {formatLabel(channel.platform)}</p>
        </div>
        <FavoriteButton target={{ type: "channel", environmentId, channelId: channel.id }} initialFavorite={channel.isFavorite} label={channel.name} />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-2.5 text-sm">
        {channelFacts.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-black/8 bg-black/2.5 p-3 dark:border-white/8 dark:bg-white/3">
            <dt className="text-[11px] font-medium text-black/40 dark:text-white/40">{label}</dt>
            <dd className={`mt-1 text-xs font-semibold ${label.endsWith("ID") ? "font-mono tabular-nums" : ""}`}>{value}</dd>
          </div>
        ))}
      </dl>

      {channel.urls.length > 0 ? <div className="mt-4">{channel.urls.map((url) => <ChannelUrl key={url} url={url} />)}</div> : (
        <p className="mt-4 text-sm text-black/40 dark:text-white/40">{channel.urlError ?? "No storefront URL is available for this channel."}</p>
      )}

      <div className="mt-auto flex items-end justify-between gap-4 pt-5">
        <p className="text-[11px] leading-4 text-black/35 dark:text-white/35">
          {modifiedDate
            ? <AppTranslatedText message="Updated {date}" values={{ date: modifiedDate }} />
            : createdDate
              ? <AppTranslatedText message="Created {date}" values={{ date: createdDate }} />
              : <AppTranslatedText message="Live channel details" />}
        </p>
        <ChannelStatus status={channel.status} />
      </div>
    </article>
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
      <div className="mx-auto w-full max-w-6xl">
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

            <CollectionBrowser
              collectionId="environment-channels"
              ariaLabel={`${environment.name} channels`}
              searchPlaceholder="Search channels…"
              columns={[
                { key: "name", label: "Channel", className: "max-w-64" },
                { key: "type", label: "Type / platform" },
                { key: "ids", label: "Channel / site ID" },
                { key: "visibility", label: "Merchant UI" },
                { key: "listings", label: "Listings" },
                { key: "url", label: "Storefront", className: "max-w-64" },
                { key: "updated", label: "Updated" },
                { key: "status", label: "Status" },
                { key: "favorite", label: "Favorite", align: "right" },
              ]}
              items={environment.channels.map((channel) => {
                const catalogHref = `/environments/${environment.id}/channels/${channel.id}`;
                const modifiedDate = formatDate(channel.dateModified);
                const createdDate = formatDate(channel.dateCreated);
                const visibility = channel.isVisible === null ? "Not reported" : channel.isVisible ? "Visible" : "Hidden";
                const listings = channel.isListableFromUi === null ? "Not reported" : channel.isListableFromUi ? "Available" : "Unavailable";
                return {
                  id: String(channel.id),
                  searchText: `${channel.name} ${channel.type} ${channel.platform} ${channel.status} ${channel.id} ${channel.siteId ?? ""} ${channel.urls.join(" ")}`,
                  card: <ChannelCard channel={channel} environmentId={environment.id} />,
                  cells: [
                    <Link key="name" href={catalogHref} className="inline-flex max-w-full items-center gap-2 font-semibold text-emerald-700 hover:text-emerald-900 dark:text-emerald-300"><span className="truncate">{channel.name}</span><CatalogActivityBadge environmentId={environment.id} channelId={channel.id} /></Link>,
                    <span key="type" className="whitespace-nowrap">{formatLabel(channel.type)} · {formatLabel(channel.platform)}</span>,
                    <span key="ids" className="font-mono text-black/55 dark:text-white/55">{channel.id} / {channel.siteId ?? "—"}</span>,
                    visibility,
                    listings,
                    channel.urls[0] ? <a key="url" href={channel.urls[0]} target="_blank" rel="noopener noreferrer" className="block truncate text-emerald-700 hover:text-emerald-900 dark:text-emerald-300">{channel.urls[0]} ↗</a> : "—",
                    modifiedDate ?? createdDate ?? "—",
                    <ChannelStatus key="status" status={channel.status} />,
                    <div key="favorite" className="flex justify-end"><FavoriteButton target={{ type: "channel", environmentId: environment.id, channelId: channel.id }} initialFavorite={channel.isFavorite} label={channel.name} /></div>,
                  ],
                };
              })}
            />
          </section>
        )}
      </div>
    </div>
  );
}
