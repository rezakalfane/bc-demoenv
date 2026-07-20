import "server-only";

import {
  getChannelFavoriteKey,
  getEnvironmentFavoriteKey,
  getFavoriteResourceKeys,
  getBigCommerceEnvironmentConnection,
  getBigCommerceEnvironmentConnections,
  type BigCommerceEnvironmentConnection,
} from "@/lib/db";
import { requireAppUser } from "@/lib/auth";

const API_BASE_URL = "https://api.bigcommerce.com/stores";
const REQUEST_TIMEOUT_MS = 8_000;
const ENVIRONMENT_CONCURRENCY = 3;
const CHANNEL_CONCURRENCY = 6;
const channelNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

class MetricRequestError extends Error {}

const metricDefinitions = [
  { key: "channels", label: "Channels", path: "/channels?limit=1" },
  {
    key: "categories",
    label: "Categories",
    path: "/catalog/trees/categories?limit=1",
  },
  {
    key: "products",
    label: "Products",
    path: "/catalog/products?limit=1&include_fields=id",
  },
  {
    key: "variants",
    label: "Variants",
    path: "/catalog/variants?limit=1&include_fields=id",
  },
] as const;

type MetricKey = (typeof metricDefinitions)[number]["key"];

export type EnvironmentMetric = {
  label: string;
  value: number | null;
  error: string | null;
};

export type EnvironmentDashboard = {
  id: number;
  name: string;
  storeHash: string;
  status: "connected" | "partial" | "unavailable";
  isFavorite: boolean;
  metrics: Record<MetricKey, EnvironmentMetric>;
};

export type EnvironmentChannel = {
  id: number;
  name: string;
  platform: string;
  type: string;
  status: string;
  isListableFromUi: boolean | null;
  isVisible: boolean | null;
  dateCreated: string | null;
  dateModified: string | null;
  siteId: number | null;
  isFavorite: boolean;
  urls: string[];
  urlError: string | null;
};

export type EnvironmentDetails = {
  id: number;
  name: string;
  storeHash: string;
  channels: EnvironmentChannel[];
  error: string | null;
};

type ChannelSummary = Omit<
  EnvironmentChannel,
  "siteId" | "isFavorite" | "urls" | "urlError"
>;

function getApiErrorMessage(
  status: number,
  fallback = "BigCommerce did not return this metric.",
) {
  if (status === 401) {
    return "Check the saved access token.";
  }

  if (status === 403) {
    return "The token is missing the required read scope.";
  }

  if (status === 404) {
    return "Check the saved store hash.";
  }

  if (status === 429) {
    return "BigCommerce rate limit reached. Try again shortly.";
  }

  return fallback;
}

function getRequestErrorMessage(error: unknown) {
  return error instanceof MetricRequestError
    ? error.message
    : error instanceof Error && error.name === "TimeoutError"
      ? "BigCommerce took too long to respond."
      : "Unable to reach BigCommerce.";
}

function isPublicUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function readOptionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

async function fetchActiveChannels(
  environment: BigCommerceEnvironmentConnection,
): Promise<ChannelSummary[]> {
  if (!environment.accessToken) {
    throw new MetricRequestError(
      "The saved token could not be decrypted. Re-save it in Settings.",
    );
  }

  const channels: ChannelSummary[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `${API_BASE_URL}/${encodeURIComponent(environment.storeHash)}/v3/channels?limit=250&page=${page}`,
      {
        headers: {
          Accept: "application/json",
          "X-Auth-Token": environment.accessToken,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw new MetricRequestError(
        getApiErrorMessage(
          response.status,
          "BigCommerce did not return the channel list.",
        ),
      );
    }

    const payload: unknown = await response.json();
    const data =
      typeof payload === "object" && payload !== null && "data" in payload
        ? (payload as { data?: unknown }).data
        : null;

    if (!Array.isArray(data)) {
      throw new MetricRequestError("BigCommerce returned an unexpected response.");
    }

    channels.push(
      ...data.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) {
          return [];
        }

        const id = "id" in entry ? Number(entry.id) : Number.NaN;
        const name = "name" in entry ? readString(entry.name) : "";
        const status = "status" in entry ? readString(entry.status) : "";
        const type = "type" in entry ? readString(entry.type) : "";
        const normalizedStatus = status.toLowerCase();

        if (
          !Number.isSafeInteger(id) ||
          id < 1 ||
          !name ||
          type.toLowerCase() !== "storefront" ||
          !["active", "prelaunch"].includes(normalizedStatus)
        ) {
          return [];
        }

        return [
          {
            id,
            name,
            platform: "platform" in entry ? readString(entry.platform) : "",
            type,
            status,
            isListableFromUi:
              "is_listable_from_ui" in entry
                ? readOptionalBoolean(entry.is_listable_from_ui)
                : null,
            isVisible:
              "is_visible" in entry
                ? readOptionalBoolean(entry.is_visible)
                : null,
            dateCreated:
              "date_created" in entry
                ? readOptionalString(entry.date_created)
                : null,
            dateModified:
              "date_modified" in entry
                ? readOptionalString(entry.date_modified)
                : null,
          },
        ];
      }),
    );

    const totalPages =
      typeof payload === "object" && payload !== null && "meta" in payload
        ? (payload as {
            meta?: { pagination?: { total_pages?: unknown } };
          }).meta?.pagination?.total_pages
        : undefined;

    if (
      typeof totalPages !== "number" ||
      !Number.isSafeInteger(totalPages) ||
      page >= totalPages
    ) {
      break;
    }

    page += 1;
  }

  return channels.sort((left, right) =>
    channelNameCollator.compare(left.name, right.name),
  );
}

async function fetchCollectionTotal(
  environment: BigCommerceEnvironmentConnection,
  path: string,
) {
  if (!environment.accessToken) {
    throw new MetricRequestError(
      "The saved token could not be decrypted. Re-save it in Settings.",
    );
  }

  const response = await fetch(
    `${API_BASE_URL}/${encodeURIComponent(environment.storeHash)}/v3${path}`,
    {
      headers: {
        Accept: "application/json",
        "X-Auth-Token": environment.accessToken,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new MetricRequestError(getApiErrorMessage(response.status));
  }

  const payload: unknown = await response.json();
  const total =
    typeof payload === "object" && payload !== null && "meta" in payload
      ? (payload as {
          meta?: { pagination?: { total?: unknown } };
        }).meta?.pagination?.total
      : undefined;

  if (typeof total !== "number" || !Number.isFinite(total)) {
    throw new MetricRequestError("BigCommerce returned an unexpected response.");
  }

  return total;
}

async function loadMetric(
  environment: BigCommerceEnvironmentConnection,
  definition: (typeof metricDefinitions)[number],
): Promise<[MetricKey, EnvironmentMetric]> {
  try {
    const value =
      definition.key === "channels"
        ? (await fetchActiveChannels(environment)).length
        : await fetchCollectionTotal(environment, definition.path);
    return [
      definition.key,
      { label: definition.label, value, error: null },
    ];
  } catch (error) {
    const message = getRequestErrorMessage(error);

    return [
      definition.key,
      { label: definition.label, value: null, error: message },
    ];
  }
}

async function loadChannelSite(
  environment: BigCommerceEnvironmentConnection & { accessToken: string },
  channel: ChannelSummary,
): Promise<EnvironmentChannel> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/${encodeURIComponent(environment.storeHash)}/v3/channels/${channel.id}/site`,
      {
        headers: {
          Accept: "application/json",
          "X-Auth-Token": environment.accessToken,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (response.status === 404) {
      return {
        ...channel,
        siteId: null,
        isFavorite: false,
        urls: [],
        urlError: null,
      };
    }

    if (!response.ok) {
      throw new MetricRequestError(
        getApiErrorMessage(
          response.status,
          "BigCommerce did not return this channel's URLs.",
        ),
      );
    }

    const payload: unknown = await response.json();
    const site =
      typeof payload === "object" && payload !== null && "data" in payload
        ? (payload as { data?: unknown }).data
        : null;
    const siteUrls =
      typeof site === "object" &&
      site !== null &&
      Array.isArray((site as { urls?: unknown }).urls)
        ? (site as { urls: unknown[] }).urls
        : [];
    const primaryUrl = siteUrls.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "type" in entry &&
        entry.type === "primary",
    );
    const primaryUrlValue =
      typeof primaryUrl === "object" &&
      primaryUrl !== null &&
      "url" in primaryUrl
        ? primaryUrl.url
        : undefined;
    const fallbackUrl =
      typeof site === "object" && site !== null
        ? (site as { url?: unknown }).url
        : undefined;
    const url = isPublicUrl(primaryUrlValue)
      ? primaryUrlValue
      : isPublicUrl(fallbackUrl)
        ? fallbackUrl
        : null;
    const siteIdValue =
      typeof site === "object" && site !== null && "id" in site
        ? Number(site.id)
        : Number.NaN;

    return {
      ...channel,
      siteId: Number.isSafeInteger(siteIdValue) ? siteIdValue : null,
      isFavorite: false,
      urls: url ? [url] : [],
      urlError: null,
    };
  } catch (error) {
    return {
      ...channel,
      siteId: null,
      isFavorite: false,
      urls: [],
      urlError: getRequestErrorMessage(error),
    };
  }
}

async function loadEnvironmentChannels(
  environment: BigCommerceEnvironmentConnection,
): Promise<EnvironmentDetails> {
  if (!environment.accessToken) {
    return {
      id: environment.id,
      name: environment.name,
      storeHash: environment.storeHash,
      channels: [],
      error: "The saved token could not be decrypted. Re-save it in Settings.",
    };
  }

  try {
    const channels = await fetchActiveChannels(environment);
    const channelDetails: EnvironmentChannel[] = [];
    const connectedEnvironment = {
      ...environment,
      accessToken: environment.accessToken,
    };

    for (let index = 0; index < channels.length; index += CHANNEL_CONCURRENCY) {
      const batch = channels.slice(index, index + CHANNEL_CONCURRENCY);
      channelDetails.push(
        ...(await Promise.all(
          batch.map((channel) => loadChannelSite(connectedEnvironment, channel)),
        )),
      );
    }

    return {
      id: environment.id,
      name: environment.name,
      storeHash: environment.storeHash,
      channels: channelDetails,
      error: null,
    };
  } catch (error) {
    return {
      id: environment.id,
      name: environment.name,
      storeHash: environment.storeHash,
      channels: [],
      error: getRequestErrorMessage(error),
    };
  }
}

async function loadEnvironmentDashboard(
  environment: BigCommerceEnvironmentConnection,
  isFavorite: boolean,
): Promise<EnvironmentDashboard> {
  const entries = await Promise.all(
    metricDefinitions.map((definition) => loadMetric(environment, definition)),
  );
  const metrics = Object.fromEntries(entries) as Record<
    MetricKey,
    EnvironmentMetric
  >;
  const availableCount = entries.filter(([, metric]) => metric.error === null)
    .length;

  return {
    id: environment.id,
    name: environment.name,
    storeHash: environment.storeHash,
    isFavorite,
    status:
      availableCount === entries.length
        ? "connected"
        : availableCount === 0
          ? "unavailable"
          : "partial",
    metrics,
  };
}

export async function getEnvironmentDashboards() {
  const user = await requireAppUser();
  const [environments, favoriteKeys] = await Promise.all([
    getBigCommerceEnvironmentConnections(user.id),
    getFavoriteResourceKeys(user.id, "environment"),
  ]);
  const dashboards: EnvironmentDashboard[] = [];

  for (
    let index = 0;
    index < environments.length;
    index += ENVIRONMENT_CONCURRENCY
  ) {
    const batch = environments.slice(index, index + ENVIRONMENT_CONCURRENCY);
    dashboards.push(
      ...(await Promise.all(
        batch.map((environment) =>
          loadEnvironmentDashboard(
            environment,
            favoriteKeys.has(getEnvironmentFavoriteKey(environment.id)),
          ),
        ),
      )),
    );
  }

  return dashboards.sort((left, right) => {
    const favoriteOrder = Number(right.isFavorite) - Number(left.isFavorite);
    if (favoriteOrder !== 0) return favoriteOrder;
    const nameOrder = left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    });
    return nameOrder !== 0 ? nameOrder : left.id - right.id;
  });
}

export async function getEnvironmentDetails(environmentId: number) {
  const user = await requireAppUser();
  const [environment, favoriteKeys] = await Promise.all([
    getBigCommerceEnvironmentConnection(user.id, environmentId),
    getFavoriteResourceKeys(user.id, "channel"),
  ]);

  if (!environment) {
    return null;
  }

  const details = await loadEnvironmentChannels(environment);
  return {
    ...details,
    channels: details.channels
      .map((channel) => ({
        ...channel,
        isFavorite: favoriteKeys.has(
          getChannelFavoriteKey(environmentId, channel.id),
        ),
      }))
      .sort((left, right) => {
        const favoriteOrder = Number(right.isFavorite) - Number(left.isFavorite);
        if (favoriteOrder !== 0) return favoriteOrder;
        return channelNameCollator.compare(left.name, right.name);
      }),
  };
}
