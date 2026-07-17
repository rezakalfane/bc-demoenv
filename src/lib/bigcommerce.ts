import "server-only";

import {
  getBigCommerceEnvironmentConnections,
  type BigCommerceEnvironmentConnection,
} from "@/lib/db";
import { requireAppUser } from "@/lib/auth";

const API_BASE_URL = "https://api.bigcommerce.com/stores";
const REQUEST_TIMEOUT_MS = 8_000;
const ENVIRONMENT_CONCURRENCY = 3;

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
  metrics: Record<MetricKey, EnvironmentMetric>;
};

function getApiErrorMessage(status: number) {
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

  return "BigCommerce did not return this metric.";
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
    const value = await fetchCollectionTotal(environment, definition.path);
    return [
      definition.key,
      { label: definition.label, value, error: null },
    ];
  } catch (error) {
    const message =
      error instanceof MetricRequestError
        ? error.message
        : error instanceof Error && error.name === "TimeoutError"
          ? "BigCommerce took too long to respond."
          : "Unable to reach BigCommerce.";

    return [
      definition.key,
      { label: definition.label, value: null, error: message },
    ];
  }
}

async function loadEnvironmentDashboard(
  environment: BigCommerceEnvironmentConnection,
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
  const environments = await getBigCommerceEnvironmentConnections(user.id);
  const dashboards: EnvironmentDashboard[] = [];

  for (
    let index = 0;
    index < environments.length;
    index += ENVIRONMENT_CONCURRENCY
  ) {
    const batch = environments.slice(index, index + ENVIRONMENT_CONCURRENCY);
    dashboards.push(...(await Promise.all(batch.map(loadEnvironmentDashboard))));
  }

  return dashboards;
}
