import "server-only";

import { requireAppUser } from "@/lib/auth";
import {
  getBigCommerceEnvironmentConnection,
  getBigCommerceEnvironmentConnections,
  getAccessibleCatalogSnapshot,
  getChannelFavoriteKey,
  getEnvironmentFavoriteKey,
  getFavoriteResourceKeys,
  type BigCommerceEnvironmentConnection,
  type CatalogSnapshotRecord,
} from "@/lib/db";
import type { CatalogSnapshotManifestV1 } from "@/lib/catalog-snapshots";
import {
  SNAPSHOT_RESTORE_GROUPS,
  parseSnapshotRestoreGroups,
  type CapturedConfigurationResource,
  type SnapshotRestoreGroup,
} from "@/lib/snapshot-configuration";

const API_BASE_URL = "https://api.bigcommerce.com/stores";
const B2B_API_BASE_URL = "https://api-b2b.bigcommerce.com/api/v3/io";
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 250;
const PRODUCT_INCLUDES = [
  "variants",
  "images",
  "custom_fields",
  "bulk_pricing_rules",
  "primary_image",
  "videos",
  "options",
  "modifiers",
].join(",");

const RATE_LIMIT_RETRIES = 4;
const BIGCOMMERCE_CDN_HOST = /^cdn\d+\.bigcommerce\.com$/i;
const STOREFRONT_ASSET_MAX_BYTES = 8 * 1024 * 1024;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

type JsonRecord = Record<string, unknown>;
type ConnectedEnvironment = BigCommerceEnvironmentConnection & {
  accessToken: string;
};

type SnapshotCategory = CatalogSnapshotManifestV1["catalog"]["categories"][number];
type SnapshotProduct = CatalogSnapshotManifestV1["catalog"]["products"][number];

export type CatalogRestoreDestination = {
  id: number;
  name: string;
  storeHash: string;
  isFavorite: boolean;
  channels: Array<{ id: number; name: string; isFavorite: boolean }>;
  error: string | null;
};

export type CatalogRestoreResult = {
  snapshotName: string;
  snapshotVersion: number;
  categoriesCreated: number;
  categoriesUpdated: number;
  categoriesRemoved: number;
  productsCreated: number;
  productsUpdated: number;
  productAssignmentsRemoved: number;
  warnings: string[];
  manualActions: CatalogRestoreManualAction[];
  restoredGroups: SnapshotRestoreGroup[];
  destinationEnvironmentName: string;
  destinationChannelName: string;
};

export type CatalogRestorePreflight = {
  canRestore: boolean;
  snapshotName: string;
  snapshotVersion: number;
  destinationEnvironmentName: string;
  destinationChannelName: string;
  selectedGroups: Array<{
    id: SnapshotRestoreGroup;
    label: string;
    scope: "channel" | "mixed" | "store";
    resourceCount: number;
  }>;
  catalog: {
    categoriesInSnapshot: number;
    categoriesToCreate: number;
    categoriesToUpdate: number;
    destinationCategoriesPreserved: number;
    categoriesConflicting: number;
    productsInSnapshot: number;
    productsToCreate: number;
    productsToMatch: number;
    destinationProductsPreserved: number;
    productsConflicting: number;
    channelAssignmentsToAdd: number;
    productsAlreadyAssigned: number;
  } | null;
  warnings: string[];
  blockingIssues: string[];
  manualActions: string[];
};

export type CatalogRestoreManualAction = {
  label: string;
  description: string;
  href: string;
};

export type ClearCatalogResult = {
  categoriesRemoved: number;
  productsUnassigned: number;
  destinationEnvironmentName: string;
  destinationChannelName: string;
};

export class CatalogRestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogRestoreError";
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readPositiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeText(value: unknown) {
  return readString(value).trim().toLocaleLowerCase("en");
}

function normalizePath(value: unknown) {
  const record = asRecord(value);
  const rawPath = record
    ? readString(record.path) || readString(record.url)
    : readString(value);

  if (!rawPath) {
    return "";
  }

  try {
    const url = new URL(rawPath, "https://catalog.invalid");
    return `/${url.pathname.split("/").filter(Boolean).join("/")}/`.toLowerCase();
  } catch {
    return `/${rawPath.split(/[?#]/, 1)[0].split("/").filter(Boolean).join("/")}/`.toLowerCase();
  }
}

function pick(record: JsonRecord, keys: readonly string[]) {
  const result: JsonRecord = {};

  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      result[key] = record[key];
    }
  }

  return result;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function extractApiMessage(payload: unknown): string {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => extractApiMessage(entry))
      .find(Boolean) ?? "";
  }
  const record = asRecord(payload);
  const errors = asRecord(record?.errors);
  const errorDetails = errors
    ? Object.values(errors).flatMap((value) =>
        typeof value === "string" ? [value] : [],
      )
    : [];
  const message =
    errorDetails[0] ||
    readString(record?.detail) ||
    readString(record?.title) ||
    readString(record?.message);

  return message.replace(/\s+/g, " ").trim().slice(0, 240);
}

function apiErrorMessage(status: number, resource: string, detail: string) {
  if (status === 401) {
    return "The destination access token is invalid. Re-save it in Settings.";
  }

  if (status === 403) {
    return "The destination token needs Products: modify and Channel Settings: read-only access.";
  }

  if (status === 404) {
    return `The destination ${resource} was not found.`;
  }

  if (status === 429) {
    return "BigCommerce rate limit persisted after automatic throttling. Try again shortly.";
  }

  return detail
    ? `BigCommerce rejected ${resource}: ${detail}`
    : `BigCommerce rejected ${resource}.`;
}

async function apiRequest(
  environment: ConnectedEnvironment,
  path: string,
  options: { method?: string; body?: unknown; resource: string },
) {
  let response!: Response;

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      response = await fetch(
        `${API_BASE_URL}/${encodeURIComponent(environment.storeHash)}/v3${path}`,
        {
          method: options.method ?? "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Auth-Token": environment.accessToken,
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw new CatalogRestoreError(
        error instanceof Error && error.name === "TimeoutError"
          ? `BigCommerce timed out while restoring ${options.resource}. The restore may be partially complete.`
          : `Unable to reach BigCommerce while restoring ${options.resource}. The restore may be partially complete.`,
      );
    }

    if (response.status !== 429 || attempt === RATE_LIMIT_RETRIES) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 15_000)
      : Math.min(750 * 2 ** attempt, 12_000);
    await wait(delay);
  }

  const text = response.status === 204 ? "" : await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok || response.status === 207) {
    throw new CatalogRestoreError(
      `${apiErrorMessage(response.status, options.resource, extractApiMessage(payload))} The restore may be partially complete.`,
    );
  }

  return payload;
}

async function uploadStorefrontAsset(
  environment: ConnectedEnvironment,
  path: string,
  sourceUrl: string,
  fieldName: "LogoFile" | "FaviconFile",
  resource: string,
) {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new CatalogRestoreError(`The captured ${resource} URL is invalid.`);
  }
  if (url.protocol !== "https:" || !BIGCOMMERCE_CDN_HOST.test(url.hostname)) {
    throw new CatalogRestoreError(
      `The captured ${resource} is not hosted on an approved BigCommerce CDN.`,
    );
  }

  const assetResponse = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!assetResponse.ok) {
    throw new CatalogRestoreError(`BigCommerce did not return the captured ${resource}.`);
  }
  const contentLength = Number(assetResponse.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > STOREFRONT_ASSET_MAX_BYTES) {
    throw new CatalogRestoreError(`The captured ${resource} exceeds 8 MB.`);
  }
  const bytes = await assetResponse.arrayBuffer();
  if (bytes.byteLength > STOREFRONT_ASSET_MAX_BYTES) {
    throw new CatalogRestoreError(`The captured ${resource} exceeds 8 MB.`);
  }

  const contentType = assetResponse.headers.get("content-type")?.split(";", 1)[0] ||
    "application/octet-stream";
  const filename = decodeURIComponent(url.pathname.split("/").at(-1) ||
    (fieldName === "LogoFile" ? "store-logo" : "favicon"));
  const form = new FormData();
  form.append(fieldName, new Blob([bytes], { type: contentType }), filename);
  const response = await fetch(
    `${API_BASE_URL}/${encodeURIComponent(environment.storeHash)}/v3${path}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-Auth-Token": environment.accessToken,
      },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const text = response.status === 204 ? "" : await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) as unknown : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new CatalogRestoreError(
      apiErrorMessage(response.status, resource, extractApiMessage(payload)),
    );
  }
}

async function b2bApiRequest(
  environment: ConnectedEnvironment,
  path: string,
  options: { method?: string; body?: unknown; resource: string },
) {
  let response!: Response;
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      response = await fetch(`${B2B_API_BASE_URL}${path}`, {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Auth-Token": environment.accessToken,
          "X-Store-Hash": environment.storeHash,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CatalogRestoreError(
        error instanceof Error && error.name === "TimeoutError"
          ? `BigCommerce B2B Edition timed out while restoring ${options.resource}.`
          : `Unable to reach BigCommerce B2B Edition while restoring ${options.resource}.`,
      );
    }
    if (response.status !== 429 || attempt === RATE_LIMIT_RETRIES) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    await wait(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 15_000)
        : Math.min(750 * 2 ** attempt, 12_000),
    );
  }
  const text = response.status === 204 ? "" : await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) as unknown : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = extractApiMessage(payload);
    const message = response.status === 403
      ? "The destination token needs B2B Edition modify access."
      : response.status === 404
        ? `B2B Edition did not expose ${options.resource} for the destination store.`
        : response.status === 429
          ? "BigCommerce B2B Edition rate limiting persisted after automatic retries."
          : detail
            ? `BigCommerce B2B Edition rejected ${options.resource}: ${detail}`
            : `BigCommerce B2B Edition rejected ${options.resource}.`;
    throw new CatalogRestoreError(message);
  }
  return payload;
}

function readB2BDataArray(payload: unknown, resource: string) {
  const data = asRecord(payload)?.data;
  if (Array.isArray(data)) return data;
  if (asRecord(data)) return Object.values(asRecord(data)!);
  throw new CatalogRestoreError(
    `BigCommerce B2B Edition returned an unexpected ${resource} response.`,
  );
}

async function fetchB2BCollection(
  environment: ConnectedEnvironment,
  path: string,
  resource: string,
) {
  const items: unknown[] = [];
  let offset = 0;
  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const payload = await b2bApiRequest(
      environment,
      `${path}${separator}limit=${PAGE_SIZE}&offset=${offset}`,
      { resource },
    );
    const page = readB2BDataArray(payload, resource);
    items.push(...page);
    const pagination = asRecord(asRecord(asRecord(payload)?.meta)?.pagination);
    const totalCount = Number(pagination?.totalCount);
    if (
      page.length === 0 ||
      page.length < PAGE_SIZE ||
      (Number.isFinite(totalCount) && items.length >= totalCount)
    ) return items;
    offset += page.length;
  }
}

async function graphqlRequest(
  environment: ConnectedEnvironment,
  query: string,
  variables: Record<string, unknown>,
  resource: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/${encodeURIComponent(environment.storeHash)}/graphql`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Auth-Token": environment.accessToken,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const payload = (await response.json()) as unknown;
  const errors = asRecord(payload)?.errors;
  const mutationErrors: unknown[] = [];
  const collectErrors = (value: unknown, depth = 0) => {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      for (const entry of value) collectErrors(entry, depth + 1);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    for (const [key, entry] of Object.entries(record)) {
      if (key === "errors" && Array.isArray(entry)) mutationErrors.push(...entry);
      else collectErrors(entry, depth + 1);
    }
  };
  collectErrors(payload);
  if (
    !response.ok ||
    (Array.isArray(errors) && errors.length > 0) ||
    mutationErrors.length > 0
  ) {
    const detail = extractApiMessage([
      ...(Array.isArray(errors) ? errors : []),
      ...mutationErrors,
    ]);
    throw new CatalogRestoreError(
      `BigCommerce rejected ${resource}${detail ? `: ${detail}` : ""}.`,
    );
  }
  return payload;
}

async function apiRequestV2(
  environment: ConnectedEnvironment,
  path: string,
  options: { method?: string; body?: unknown; resource: string },
) {
  const response = await fetch(
    `${API_BASE_URL}/${encodeURIComponent(environment.storeHash)}/v2${path}`,
    {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Auth-Token": environment.accessToken,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const text = response.status === 204 ? "" : await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) as unknown : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new CatalogRestoreError(
      apiErrorMessage(response.status, options.resource, extractApiMessage(payload)),
    );
  }
  return payload;
}

const SHIPPING_ZONE_FIELDS = [
  "name", "type", "enabled", "free_shipping", "handling_fees", "locations",
] as const;
const SHIPPING_METHOD_FIELDS = [
  "name", "type", "enabled", "handling_fees", "settings",
] as const;

function shippingZoneInput(source: JsonRecord, includeType: boolean) {
  const body = pick(source, SHIPPING_ZONE_FIELDS);
  if (!includeType) delete body.type;
  if (normalizeText(source.type) === "global") {
    delete body.locations;
  } else if (Array.isArray(source.locations)) {
    body.locations = source.locations.flatMap((value) => {
      const location = asRecord(value);
      if (!location) return [];
      const writable = { ...location };
      delete writable.id;
      return [writable];
    });
  }
  return body;
}

async function reconcileShippingConfiguration(
  environment: ConnectedEnvironment,
  destinationChannelId: number,
  resources: Record<string, CapturedConfigurationResource>,
  bestEffort: (label: string, work: () => Promise<unknown>) => Promise<void>,
) {
  const sourceZones = capturedData(resources.shippingZones);
  if (!Array.isArray(sourceZones)) return;
  const targetPayload = await apiRequestV2(environment, "/shipping/zones", {
    resource: "destination shipping zones",
  });
  const targetZones = Array.isArray(targetPayload)
    ? targetPayload.flatMap((value) => asRecord(value) ? [asRecord(value)!] : [])
    : [];
  const methodsByZone = asRecord(capturedData(resources.shippingMethods)) ?? {};

  for (const value of sourceZones) {
    const source = asRecord(value);
    const sourceId = readPositiveInteger(source?.id);
    const name = readString(source?.name);
    if (!sourceId || !name) continue;
    const target = targetZones.find((candidate) =>
      normalizeText(source?.type) === "global"
        ? normalizeText(candidate.type) === "global"
        : normalizeText(candidate.name) === normalizeText(name),
    );
    let targetId = readPositiveInteger(target?.id);
    await bestEffort(`Shipping zone ${name}`, async () => {
      const isExistingGlobalZone = Boolean(targetId) &&
        normalizeText(source?.type) === "global";
      if (!isExistingGlobalZone) {
        const payload = await apiRequestV2(
          environment,
          targetId ? `/shipping/zones/${targetId}` : "/shipping/zones",
          {
            method: targetId ? "PUT" : "POST",
            body: shippingZoneInput(source!, !targetId),
            resource: `shipping zone ${name}`,
          },
        );
        targetId ??= readPositiveInteger(asRecord(payload)?.id);
      }
      if (!targetId) return;
      const targetMethodsPayload = await apiRequestV2(
        environment,
        `/shipping/zones/${targetId}/methods`,
        { resource: `shipping methods for ${name}` },
      );
      const targetMethods = Array.isArray(targetMethodsPayload)
        ? targetMethodsPayload.flatMap((entry) => asRecord(entry) ? [asRecord(entry)!] : [])
        : [];
      const sourceMethods = methodsByZone[String(sourceId)];
      if (!Array.isArray(sourceMethods)) return;
      for (const methodValue of sourceMethods) {
        const method = asRecord(methodValue);
        const methodName = readString(method?.name);
        if (!method || !methodName) continue;
        const targetMethod = targetMethods.find(
          (candidate) =>
            normalizeText(candidate.name) === normalizeText(methodName) &&
            normalizeText(candidate.type) === normalizeText(method.type),
        );
        const targetMethodId = readPositiveInteger(targetMethod?.id);
        const existingChannelIds = Array.isArray(targetMethod?.channel_ids)
          ? targetMethod.channel_ids.flatMap((value) => {
              const channelId = readPositiveInteger(value);
              return channelId ? [channelId] : [];
            })
          : [];
        const channelIds = [...new Set([
          ...existingChannelIds,
          destinationChannelId,
        ])];
        await apiRequestV2(
          environment,
          targetMethodId
            ? `/shipping/zones/${targetId}/methods/${targetMethodId}`
            : `/shipping/zones/${targetId}/methods`,
          {
            method: targetMethodId ? "PUT" : "POST",
            body: {
              ...pick(method, SHIPPING_METHOD_FIELDS),
              channel_ids: channelIds,
            },
            resource: `shipping method ${methodName}`,
          },
        );
      }
    });
  }
}

async function reconcileTaxConfiguration(
  environment: ConnectedEnvironment,
  resources: Record<string, CapturedConfigurationResource>,
  bestEffort: (label: string, work: () => Promise<unknown>) => Promise<void>,
) {
  const sourceZones = capturedData(resources.taxZones);
  const sourceRates = capturedData(resources.taxRates);
  if (!Array.isArray(sourceZones)) return new Map<number, number>();
  const targetZones = (
    await fetchCollection(environment, "/tax/zones", "destination tax zones")
  ).flatMap((value) => asRecord(value) ? [asRecord(value)!] : []);
  const zoneMap = new Map<number, number>();

  for (const value of sourceZones) {
    const source = asRecord(value);
    const sourceId = readPositiveInteger(source?.id);
    const name = readString(source?.name);
    if (!sourceId || !name) continue;
    const isDefaultZone = sourceId === 1 || normalizeText(name) === "default zone";
    const target = isDefaultZone
      ? targetZones.find((zone) => Number(zone.id) === 1) ??
        targetZones.find((zone) => normalizeText(zone.name) === "default zone")
      : targetZones.find((zone) => normalizeText(zone.name) === normalizeText(name));
    let targetId = readPositiveInteger(target?.id);
    if (targetId) zoneMap.set(sourceId, targetId);
    await bestEffort(`Tax zone ${name}`, async () => {
      const body = { ...source };
      delete body.id;
      if (isDefaultZone) {
        // BigCommerce's default zone always covers shoppers not matched by another
        // zone. Its location and customer-group targeting is immutable and is
        // returned inside shopper_target_settings, but that response field must
        // not be echoed back in an update request.
        delete body.shopper_target_settings;
        delete body.enabled;
        // Retain compatibility with older captured Tax API response shapes.
        delete body.locations;
        delete body.customer_groups;
        delete body.customer_group_ids;
      }
      const payload = await apiRequest(environment, "/tax/zones", {
        method: targetId ? "PUT" : "POST",
        body: [{ ...(targetId ? { id: targetId } : {}), ...body }],
        resource: `tax zone ${name}`,
      });
      if (!targetId) {
        const created = readDataArray(payload, `tax zone ${name}`)[0];
        targetId = readPositiveInteger(asRecord(created)?.id);
      }
      if (targetId) zoneMap.set(sourceId, targetId);
    });
  }

  if (!Array.isArray(sourceRates)) return zoneMap;
  const targetRates = (
    await fetchCollection(environment, "/tax/rates", "destination tax rates")
  ).flatMap((value) => asRecord(value) ? [asRecord(value)!] : []);
  const sourceTaxClasses = Array.isArray(capturedData(resources.taxClasses))
    ? (capturedData(resources.taxClasses) as unknown[]).flatMap((value) => asRecord(value) ? [asRecord(value)!] : [])
    : [];
  const targetTaxClasses = await resolveTaxClassMap(environment);

  for (const value of sourceRates) {
    const source = asRecord(value);
    const sourceZoneId = readPositiveInteger(source?.tax_zone_id);
    const targetZoneId = sourceZoneId ? zoneMap.get(sourceZoneId) : undefined;
    const name = readString(source?.name);
    if (!source || !targetZoneId || !name) continue;
    const target = targetRates.find(
      (rate) => Number(rate.tax_zone_id) === targetZoneId && normalizeText(rate.name) === normalizeText(name),
    );
    const targetId = readPositiveInteger(target?.id);
    const classRates = Array.isArray(source.class_rates)
      ? source.class_rates.flatMap((entry) => {
          const classRate = asRecord(entry);
          const sourceClass = sourceTaxClasses.find(
            (taxClass) => Number(taxClass.id) === Number(classRate?.tax_class_id),
          );
          const targetClass = targetTaxClasses.find(
            (taxClass) => normalizeText(taxClass.name) === normalizeText(sourceClass?.name),
          );
          const taxClassId = readPositiveInteger(targetClass?.id) ??
            (Number(classRate?.tax_class_id) === 0 ? 0 : null);
          return taxClassId === null
            ? []
            : [{ tax_class_id: taxClassId, rate: Number(classRate?.rate) || 0 }];
        })
      : [];
    await bestEffort(`Tax rate ${name}`, () =>
      apiRequest(environment, "/tax/rates", {
        method: targetId ? "PUT" : "POST",
        body: [{
          ...(targetId ? { id: targetId } : {}),
          ...pick(source, ["name", "enabled", "priority"]),
          tax_zone_id: targetZoneId,
          class_rates: classRates,
        }],
        resource: `tax rate ${name}`,
      }),
    );
  }
  return zoneMap;
}

const CURRENCY_CREATE_FIELDS = [
  "currency_code", "currency_exchange_rate", "token_location", "token",
  "decimal_token", "thousands_token", "decimal_places", "name", "country_iso2",
  "auto_update", "enabled", "is_transactional",
] as const;
const PRICE_LIST_RECORD_FIELDS = [
  "currency", "price", "sale_price", "retail_price", "map_price",
  "bulk_pricing_tiers",
] as const;

async function prepareCurrencyAssignments(
  environment: ConnectedEnvironment,
  destinationChannelId: number,
  resources: Record<string, CapturedConfigurationResource>,
  assignments: JsonRecord,
  snapshotStore: CatalogSnapshotManifestV1["store"],
  warnings: string[],
) {
  const requested = Array.isArray(assignments.enabled_currencies)
    ? assignments.enabled_currencies.flatMap((value) => {
        const code = readString(value).trim().toUpperCase();
        return code ? [code] : [];
      })
    : [];
  const defaultCurrency = readString(assignments.default_currency).trim().toUpperCase();
  const requestedCodes = [...new Set([...requested, defaultCurrency].filter(Boolean))];
  if (requestedCodes.length === 0) return assignments;

  const destinationPayload = await apiRequestV2(environment, "/currencies", {
    resource: "destination store currencies",
  });
  const destinationCurrencies = Array.isArray(destinationPayload)
    ? destinationPayload.flatMap((value) => asRecord(value) ? [asRecord(value)!] : [])
    : [];
  const sourcePayload = capturedData(resources.storeCurrencies);
  const sourceCurrencies = Array.isArray(sourcePayload)
    ? sourcePayload.flatMap((value) => asRecord(value) ? [asRecord(value)!] : [])
    : [];
  const needsStoreMutation = requestedCodes.some((code) => {
    const destination = destinationCurrencies.find(
      (currency) => readString(currency.currency_code).toUpperCase() === code,
    );
    return !destination || !destination.enabled;
  });
  const preservedChannelAssignments = new Map<number, JsonRecord>();

  if (needsStoreMutation) {
    for (const channel of await listChannels(environment)) {
      if (channel.id === destinationChannelId) continue;
      const payload = await apiRequest(
        environment,
        `/channels/${channel.id}/currency-assignments`,
        { resource: `currency assignments for ${channel.name}` },
      );
      const preserved = writableObject(asRecord(payload)?.data);
      if (!preserved) {
        throw new CatalogRestoreError(
          `BigCommerce returned unexpected currency assignments for ${channel.name}.`,
        );
      }
      preservedChannelAssignments.set(channel.id, preserved);
    }
  }

  let storeVisibilityChanged = false;

  for (const code of requestedCodes) {
    const destination = destinationCurrencies.find(
      (currency) => readString(currency.currency_code).toUpperCase() === code,
    );
    try {
      if (destination) {
        if (!destination.enabled) {
          const id = readPositiveInteger(destination.id);
          if (!id) throw new CatalogRestoreError(`Currency ${code} has no destination ID.`);
          await apiRequestV2(environment, `/currencies/${id}`, {
            method: "PUT",
            body: { enabled: true },
            resource: `currency ${code}`,
          });
          destination.enabled = true;
          storeVisibilityChanged = true;
        }
        continue;
      }

      const capturedSource = sourceCurrencies.find(
        (currency) => readString(currency.currency_code).toUpperCase() === code,
      );
      const source = capturedSource ?? (
        code === snapshotStore.currency.toUpperCase()
          ? {
              currency_code: code,
              currency_exchange_rate: "1.0000000000",
              token_location: snapshotStore.currencySymbolLocation || "left",
              token: snapshotStore.currencySymbol || code,
              decimal_token: ".",
              thousands_token: ",",
              decimal_places: snapshotStore.decimalPlaces,
              name: code,
              auto_update: false,
              is_transactional: true,
            }
          : null
      );
      if (!source) {
        throw new CatalogRestoreError(
          `Currency ${code} is missing from the snapshot's captured store-currency definitions. Create a new snapshot version or add the currency in the destination store first.`,
        );
      }
      const body = { ...pick(source, CURRENCY_CREATE_FIELDS), enabled: true };
      const created = asRecord(await apiRequestV2(environment, "/currencies", {
        method: "POST",
        body,
        resource: `store currency ${code}`,
      }));
      if (created) destinationCurrencies.push(created);
      storeVisibilityChanged = true;
    } catch (error) {
      warnings.push(
        `Currency ${code}: ${error instanceof Error ? error.message : "Could not enable currency."}`,
      );
    }
  }

  if (storeVisibilityChanged) {
    for (const [channelId, preserved] of preservedChannelAssignments) {
      try {
        await apiRequest(
          environment,
          `/channels/${channelId}/currency-assignments`,
          {
            method: "PUT",
            body: preserved,
            resource: `preserved currency assignments for channel ${channelId}`,
          },
        );
      } catch (error) {
        warnings.push(
          `Channel ${channelId} currency visibility: ${error instanceof Error ? error.message : "Could not preserve the existing channel assignment."}`,
        );
      }
    }
  }

  const enabledCodes = new Set(
    destinationCurrencies.flatMap((currency) =>
      currency.enabled ? [readString(currency.currency_code).toUpperCase()] : [],
    ),
  );
  const supported = requested.filter((code) => enabledCodes.has(code));
  const unsupported = requested.filter((code) => !enabledCodes.has(code));
  if (unsupported.length > 0) {
    warnings.push(
      `Currency assignments skipped unavailable destination currencies: ${unsupported.join(", ")}.`,
    );
  }
  if (defaultCurrency && !enabledCodes.has(defaultCurrency)) {
    warnings.push(
      `Currency assignments were not changed because the snapshot default currency ${defaultCurrency} is unavailable in the destination store.`,
    );
    return null;
  }
  return { ...assignments, enabled_currencies: supported };
}

function readDataArray(payload: unknown, resource: string) {
  const data = asRecord(payload)?.data;

  if (!Array.isArray(data)) {
    throw new CatalogRestoreError(
      `BigCommerce returned an unexpected ${resource} response.`,
    );
  }

  return data;
}

function readTotalPages(payload: unknown) {
  const meta = asRecord(asRecord(payload)?.meta);
  const pagination = asRecord(meta?.pagination);
  const totalPages = Number(pagination?.total_pages);
  return Number.isSafeInteger(totalPages) && totalPages > 0 ? totalPages : 1;
}

async function fetchCollection(
  environment: ConnectedEnvironment,
  path: string,
  resource: string,
) {
  const items: unknown[] = [];
  let page = 1;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const payload = await apiRequest(
      environment,
      `${path}${separator}limit=${PAGE_SIZE}&page=${page}`,
      { resource },
    );
    items.push(...readDataArray(payload, resource));

    if (page >= readTotalPages(payload)) {
      return items;
    }

    page += 1;
  }
}

async function listChannels(
  environment: ConnectedEnvironment,
  favoriteKeys: Set<string> = new Set(),
) {
  const channels = await fetchCollection(environment, "/channels", "channels");

  return channels.flatMap((value) => {
    const channel = asRecord(value);
    const id = readPositiveInteger(channel?.id);
    const name = readString(channel?.name);

    return id && name && normalizeText(channel?.type) === "storefront" && ["active", "prelaunch"].includes(normalizeText(channel?.status))
      ? [{
          id,
          name,
          isFavorite: favoriteKeys.has(getChannelFavoriteKey(environment.id, id)),
        }]
      : [];
  }).sort((left, right) => {
    const favoriteOrder = Number(right.isFavorite) - Number(left.isFavorite);
    if (favoriteOrder !== 0) return favoriteOrder;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

export async function getCatalogRestoreDestinations(): Promise<
  CatalogRestoreDestination[]
> {
  const user = await requireAppUser();
  const [environments, environmentFavoriteKeys, channelFavoriteKeys] = await Promise.all([
    getBigCommerceEnvironmentConnections(user.id),
    getFavoriteResourceKeys(user.id, "environment"),
    getFavoriteResourceKeys(user.id, "channel"),
  ]);
  const destinations: CatalogRestoreDestination[] = [];

  for (const environment of environments) {
    const isFavorite = environmentFavoriteKeys.has(getEnvironmentFavoriteKey(environment.id));

    if (!environment.accessToken) {
      destinations.push({
        id: environment.id,
        name: environment.name,
        storeHash: environment.storeHash,
        isFavorite,
        channels: [],
        error: "The saved token could not be decrypted. Re-save it in Settings.",
      });
      continue;
    }

    try {
      destinations.push({
        id: environment.id,
        name: environment.name,
        storeHash: environment.storeHash,
        isFavorite,
        channels: await listChannels(
          { ...environment, accessToken: environment.accessToken },
          channelFavoriteKeys,
        ),
        error: null,
      });
    } catch (error) {
      destinations.push({
        id: environment.id,
        name: environment.name,
        storeHash: environment.storeHash,
        isFavorite,
        channels: [],
        error:
          error instanceof CatalogRestoreError
            ? error.message.replace(/ The restore may be partially complete\.$/, "")
            : "Unable to load channels.",
      });
    }
  }

  return destinations.sort((left, right) => {
    const favoriteOrder = Number(right.isFavorite) - Number(left.isFavorite);
    if (favoriteOrder !== 0) return favoriteOrder;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

function parseManifest(snapshot: CatalogSnapshotRecord) {
  let manifest: unknown;

  try {
    manifest = JSON.parse(snapshot.payloadJson) as unknown;
  } catch {
    throw new CatalogRestoreError("This snapshot payload is invalid.");
  }

  const record = asRecord(manifest);
  const source = asRecord(record?.source);
  const catalog = asRecord(record?.catalog);

  if (
    Number(record?.formatVersion) !== 1 ||
    !source ||
    !catalog ||
    !Array.isArray(catalog.categories) ||
    !Array.isArray(catalog.products) ||
    readPositiveInteger(source.environmentId) !== snapshot.sourceEnvironmentId ||
    readPositiveInteger(source.channelId) !== snapshot.sourceChannelId ||
    readString(source.storeHash) !== snapshot.sourceStoreHash
  ) {
    throw new CatalogRestoreError(
      "This snapshot is invalid, inconsistent, or uses an unsupported format.",
    );
  }

  return manifest as CatalogSnapshotManifestV1;
}

export async function getCatalogRestorePreflight(input: {
  snapshotId: number;
  destinationEnvironmentId: number;
  destinationChannelId: number;
  restoreGroups: SnapshotRestoreGroup[];
  userId?: string;
}): Promise<CatalogRestorePreflight> {
  const userId = input.userId ?? (await requireAppUser()).id;
  const snapshot = await getAccessibleCatalogSnapshot(userId, input.snapshotId);
  if (!snapshot) {
    throw new CatalogRestoreError(
      "The selected snapshot is no longer published or is unavailable.",
    );
  }
  const manifest = parseManifest(snapshot);
  const { environment, channelName } = await resolveDestination(
    userId,
    input.destinationEnvironmentId,
    input.destinationChannelId,
  );
  const requestedGroups = parseSnapshotRestoreGroups(input.restoreGroups);
  const availableGroups = new Set<SnapshotRestoreGroup>([
    "catalog",
    ...Object.keys(manifest.configuration ?? {}).flatMap((group) =>
      parseSnapshotRestoreGroups([group]),
    ),
  ]);
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const manualActions: string[] = [];
  if (requestedGroups.length === 0) {
    blockingIssues.push("Choose at least one snapshot section to restore.");
  }
  for (const group of requestedGroups) {
    if (!availableGroups.has(group)) {
      blockingIssues.push(
        `The selected snapshot does not contain the ${group.replaceAll("_", " ")} section.`,
      );
    }
  }
  const restoreGroups = requestedGroups.filter((group) => availableGroups.has(group));
  const selectedGroups = restoreGroups.flatMap((id) => {
    const definition = SNAPSHOT_RESTORE_GROUPS.find((group) => group.id === id);
    if (!definition) return [];
    let resourceCount = Object.values(manifest.catalog).reduce(
      (total, records) => total + (Array.isArray(records) ? records.length : 0),
      0,
    );
    if (id !== "catalog") {
      const resources = manifest.configuration?.[id]?.resources;
      resourceCount = resources ? Object.keys(resources).length : 0;
      for (const resource of Object.values(resources ?? {})) {
        if (resource.warning) warnings.push(`${resource.label}: ${resource.warning}`);
      }
    }
    return [{
      id,
      label: definition.label,
      scope: definition.scope,
      resourceCount,
    }];
  });

  if (selectedGroups.some((group) => group.scope === "store")) {
    warnings.push(
      "One or more selected sections are store-wide and can affect channels other than the destination.",
    );
  }
  if (
    environment.storeHash === snapshot.sourceStoreHash &&
    input.destinationChannelId === snapshot.sourceChannelId
  ) {
    warnings.push("The destination is the channel from which this snapshot was captured.");
  }
  if (restoreGroups.includes("pricing")) {
    manualActions.push(
      "Payment-provider visibility must be reviewed manually after currency restoration.",
    );
  }

  let catalog: CatalogRestorePreflight["catalog"] = null;
  if (restoreGroups.includes("catalog")) {
    const trees = await fetchCollection(
      environment,
      `/catalog/trees?channel_id:in=${input.destinationChannelId}`,
      "destination category trees for restore preflight",
    );
    const treeId = trees
      .map(asRecord)
      .map((tree) => readPositiveInteger(tree?.id))
      .find((id): id is number => Boolean(id));
    const targetCategories = treeId
      ? (await fetchCollection(
          environment,
          `/catalog/trees/categories?tree_id:in=${treeId}`,
          "destination categories for restore preflight",
        )).flatMap((value) => asRecord(value) ? [asRecord(value)!] : [])
      : [];
    const sourceById = new Map<number, SnapshotCategory>();
    for (const category of manifest.catalog.categories) {
      const id = readPositiveInteger(category.data.category_id);
      if (id) sourceById.set(id, category);
    }
    const orderedCategories = [...manifest.catalog.categories].sort(
      (left, right) =>
        categoryDepth(left, sourceById) - categoryDepth(right, sourceById),
    );
    const availableTargets = new Set(targetCategories);
    const categoryMap = new Map<number, number>();
    let categoriesToCreate = 0;
    let categoriesToUpdate = 0;
    let categoriesConflicting = 0;
    for (const sourceCategory of orderedCategories) {
      const source = sourceCategory.data;
      const sourceId = readPositiveInteger(source.category_id);
      const name = readString(source.name).trim();
      if (!sourceId || !name) {
        categoriesConflicting += 1;
        blockingIssues.push("The snapshot contains an invalid category record.");
        continue;
      }
      const sourceParentId = readPositiveInteger(source.parent_id);
      const parentId = sourceParentId ? categoryMap.get(sourceParentId) ?? 0 : 0;
      const sourcePath = normalizePath(source.url);
      const match = [...availableTargets].find((candidate) => {
        const candidatePath = normalizePath(candidate.url);
        return sourcePath
          ? candidatePath === sourcePath
          : normalizeText(candidate.name) === normalizeText(name) &&
              Number(candidate.parent_id) === parentId;
      });
      const targetId = readPositiveInteger(match?.category_id);
      if (match && targetId) {
        categoriesToUpdate += 1;
        categoryMap.set(sourceId, targetId);
        availableTargets.delete(match);
      } else {
        categoriesToCreate += 1;
        categoryMap.set(sourceId, -sourceId);
      }
    }

    const targetProducts = (
      await fetchCollection(
        environment,
        "/catalog/products?include=variants",
        "destination products for restore preflight",
      )
    ).flatMap((value) => asRecord(value) ? [asRecord(value)!] : []);
    const assignments = await fetchCollection(
      environment,
      `/catalog/products/channel-assignments?channel_id:in=${input.destinationChannelId}`,
      "destination channel assignments for restore preflight",
    );
    const assignedProductIds = new Set(assignments.flatMap((value) => {
      const id = readPositiveInteger(asRecord(value)?.product_id);
      return id ? [id] : [];
    }));
    const availableProducts = new Set(targetProducts);
    const sourceProductIdentities = new Map<
      string,
      { id: number | null; name: string; index: number }
    >();
    const conflictingProductIndexes = new Set<number>();
    const matchedAssignedProductIds = new Set<number>();
    let productsToCreate = 0;
    let productsToMatch = 0;
    let channelAssignmentsToAdd = 0;
    let productsAlreadyAssigned = 0;
    for (const [sourceIndex, sourceRecord] of manifest.catalog.products.entries()) {
      const name = readString(sourceRecord.data.name) || "Unnamed product";
      const sourceKey = productMatchKey(sourceRecord.data);
      const identities = [
        ...[...sourceKey.skus].map((sku) => `sku:${sku}`),
        ...(sourceKey.slug ? [`slug:${sourceKey.slug}`] : []),
      ];
      for (const identity of identities) {
        const previous = sourceProductIdentities.get(identity);
        const sourceId = readPositiveInteger(sourceRecord.data.id);
        if (previous && previous.id !== sourceId) {
          conflictingProductIndexes.add(previous.index);
          conflictingProductIndexes.add(sourceIndex);
          blockingIssues.push(
            `Snapshot products “${previous.name}” and “${name}” share ${identity.replace(":", " ")}.`,
          );
        } else {
          sourceProductIdentities.set(identity, {
            id: sourceId ?? null,
            name,
            index: sourceIndex,
          });
        }
      }
      const matches = [...availableProducts].filter((target) => {
        const targetKey = productMatchKey(target);
        return [...sourceKey.skus].some((sku) => targetKey.skus.has(sku)) ||
          Boolean(sourceKey.slug && targetKey.slug === sourceKey.slug);
      });
      if (matches.length > 1) {
        conflictingProductIndexes.add(sourceIndex);
        blockingIssues.push(
          `Product “${name}” matches more than one destination product by SKU or slug.`,
        );
        continue;
      }
      const target = matches[0];
      if (!target) {
        productsToCreate += 1;
        channelAssignmentsToAdd += 1;
        continue;
      }
      availableProducts.delete(target);
      productsToMatch += 1;
      const targetId = readPositiveInteger(target.id);
      if (targetId && assignedProductIds.has(targetId)) {
        productsAlreadyAssigned += 1;
        matchedAssignedProductIds.add(targetId);
      } else {
        channelAssignmentsToAdd += 1;
      }
    }
    catalog = {
      categoriesInSnapshot: manifest.catalog.categories.length,
      categoriesToCreate,
      categoriesToUpdate,
      destinationCategoriesPreserved: availableTargets.size,
      categoriesConflicting,
      productsInSnapshot: manifest.catalog.products.length,
      productsToCreate,
      productsToMatch,
      destinationProductsPreserved: Math.max(
        0,
        assignedProductIds.size - matchedAssignedProductIds.size,
      ),
      productsConflicting: conflictingProductIndexes.size,
      channelAssignmentsToAdd,
      productsAlreadyAssigned,
    };
  }

  return {
    canRestore: blockingIssues.length === 0,
    snapshotName: snapshot.name,
    snapshotVersion: snapshot.snapshotVersion,
    destinationEnvironmentName: environment.name,
    destinationChannelName: channelName,
    selectedGroups,
    catalog,
    warnings: [...new Set(warnings)],
    blockingIssues: [...new Set(blockingIssues)],
    manualActions,
  };
}

function capturedData(resource: CapturedConfigurationResource | undefined) {
  if (!resource || resource.warning || resource.data == null) return null;
  const record = asRecord(resource.data);
  return record && "data" in record ? record.data : resource.data;
}

function writableObject(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  const result = { ...record };
  for (const key of [
    "id", "uuid", "channel_id", "site_id", "date_created", "date_modified",
    "created_at", "updated_at", "createdAt", "updatedAt", "meta",
  ]) {
    delete result[key];
  }
  return result;
}

const STOREFRONT_SETTING_ENDPOINTS = [
  {
    key: "profile",
    path: "/settings/store/profile",
    // Contact email is destination-owned and must not be copied across stores.
    fields: ["store_name", "store_address", "store_phone"],
  },
  {
    key: "seo",
    path: "/settings/storefront/seo",
    fields: ["page_title", "meta_keywords", "meta_description", "www_redirect"],
  },
  {
    key: "robots",
    path: "/settings/storefront/robotstxt",
    fields: ["robots_txt_ssl"],
  },
  {
    key: "productDisplay",
    path: "/settings/storefront/product",
    fields: [
      "show_product_price", "show_product_sku", "show_product_weight",
      "show_product_brand", "show_product_shipping", "show_product_rating",
      "show_add_to_cart_link", "default_preorder_message",
      "show_breadcrumbs_product_pages", "show_add_to_cart_qty_box",
      "show_add_to_wishlist", "hide_price_from_guests",
    ],
  },
  {
    key: "categoryDisplay",
    path: "/settings/storefront/category",
    fields: ["listing_mode", "default_product_sort", "category_tree_depth"],
  },
  {
    key: "catalogPreferences",
    path: "/settings/catalog",
    fields: ["auto_approve_reviews", "enable_product_comparisons"],
  },
  {
    key: "inventoryRules",
    path: "/settings/inventory",
    fields: [
      "product_out_of_stock_behavior", "option_out_of_stock_behavior",
      "update_stock_behavior", "edit_order_stock_adjustment",
      "refund_order_stock_adjustment", "stock_level_display",
      "default_out_of_stock_message", "hide_in_product_filtering",
      "show_pre_order_stock_levels", "show_out_of_stock_message",
    ],
  },
  {
    key: "search",
    path: "/settings/storefront/search",
    // product_filtering_enabled is global-only and cannot be a channel override.
    fields: ["default_product_sort", "content_product_sort", "search_suggest"],
  },
  {
    key: "statusMessages",
    path: "/settings/storefront/status",
    // prelaunch_password is generated by BigCommerce and read-only.
    fields: ["down_for_maintenance_message", "prelaunch_message"],
  },
] as const;

function storefrontCustomerSettingsInput(
  source: JsonRecord,
  sourceGroups: unknown,
  targetGroups: unknown,
  warnings: string[],
) {
  const body: JsonRecord = {};
  const privacy = asRecord(source.privacy_settings);
  if (privacy) {
    body.privacy_settings = pick(privacy, [
      "ask_shopper_for_tracking_consent",
      "policy_url",
      "ask_shopper_for_tracking_consent_on_checkout",
    ]);
  }
  if (typeof source.allow_global_logins === "boolean") {
    body.allow_global_logins = source.allow_global_logins;
  }

  const sourceGroupRecords = Array.isArray(sourceGroups)
    ? sourceGroups.flatMap((value) => asRecord(value) ? [asRecord(value)!] : [])
    : [];
  const targetGroupRecords = Array.isArray(targetGroups)
    ? targetGroups.flatMap((value) => asRecord(value) ? [asRecord(value)!] : [])
    : [];
  const sourceGroupSettings = asRecord(source.customer_group_settings);
  if (sourceGroupSettings) {
    const mapped: JsonRecord = {};
    for (const key of ["guest_customer_group_id", "default_customer_group_id"] as const) {
      const sourceId = Number(sourceGroupSettings[key]);
      if (!Number.isSafeInteger(sourceId) || sourceId < 0) continue;
      if (sourceId === 0) {
        mapped[key] = 0;
        continue;
      }
      const sourceGroup = sourceGroupRecords.find((group) => Number(group.id) === sourceId);
      const sourceName = readString(sourceGroup?.name);
      const targetGroup = sourceName
        ? targetGroupRecords.find((group) => normalizeText(group.name) === normalizeText(sourceName))
        : undefined;
      const targetId = readPositiveInteger(targetGroup?.id);
      if (targetId) mapped[key] = targetId;
      else warnings.push(
        `Customer privacy: customer group ${sourceName || sourceId} does not exist in the destination and was not assigned.`,
      );
    }
    if (Object.keys(mapped).length > 0) body.customer_group_settings = mapped;
  }
  return body;
}

const B2B_COMPANY_FIELDS = [
  "companyName", "companyEmail", "companyPhone", "addressLine1", "addressLine2",
  "city", "state", "country", "zipCode", "uuid", "extraFields",
] as const;
const B2B_USER_FIELDS = [
  "email", "firstName", "lastName", "phoneNumber", "uuid", "extraFields",
] as const;
const B2B_ADDRESS_FIELDS = [
  "addressLine1", "addressLine2", "city", "stateCode", "stateName", "countryCode",
  "countryName", "zipCode", "firstName", "lastName", "isBilling", "isDefaultBilling",
  "isShipping", "isDefaultShipping", "phoneNumber", "label", "extraFields",
] as const;

function b2bRecordId(record: JsonRecord | null, ...keys: string[]) {
  return keys.reduce<number | null>(
    (found, key) => found ?? readPositiveInteger(record?.[key]),
    null,
  );
}

async function reconcileB2BConfiguration(
  environment: ConnectedEnvironment,
  destinationChannelId: number,
  manifest: CatalogSnapshotManifestV1,
  resources: Record<string, CapturedConfigurationResource>,
  warnings: string[],
  bestEffort: (label: string, work: () => Promise<unknown>) => Promise<void>,
  sourceToTargetProduct: Map<number, number>,
) {
  const sourcePermissions = capturedData(resources.permissions);
  const sourceRoles = capturedData(resources.roles);
  const destinationPermissions = await fetchB2BCollection(
    environment,
    "/companies/permissions",
    "destination Company permissions",
  );
  const destinationRoles = await fetchB2BCollection(
    environment,
    "/companies/roles",
    "destination Company roles",
  );

  if (Array.isArray(sourcePermissions)) {
    for (const value of sourcePermissions) {
      const permission = asRecord(value);
      const code = readString(permission?.code);
      const isCustom = permission?.isCustom === true || Number(permission?.isCustom) === 1;
      if (!permission || !code || !isCustom) continue;
      const exists = destinationPermissions.some(
        (candidate) => normalizeText(asRecord(candidate)?.code) === normalizeText(code),
      );
      if (exists) continue;
      await bestEffort(`B2B permission ${code}`, async () => {
        const payload = pick(permission, ["name", "description", "code", "moduleName"]);
        await b2bApiRequest(environment, "/companies/permissions", {
          method: "POST",
          body: payload,
          resource: `Company permission ${code}`,
        });
        destinationPermissions.push(permission);
      });
    }
  }

  const sourceRoleToTarget = new Map<number, number>();
  if (Array.isArray(sourceRoles)) {
    for (const value of sourceRoles) {
      const role = asRecord(value);
      const sourceId = b2bRecordId(role, "id", "roleId");
      const name = readString(role?.name);
      const roleType = Number(role?.roleType);
      if (!role || !sourceId || !name) continue;
      const existing = destinationRoles.find(
        (candidate) => normalizeText(asRecord(candidate)?.name) === normalizeText(name),
      );
      let targetId = b2bRecordId(asRecord(existing), "id", "roleId");
      if (targetId) sourceRoleToTarget.set(sourceId, targetId);
      if (roleType !== 2) {
        if (targetId) sourceRoleToTarget.set(sourceId, targetId);
        continue;
      }
      const permissions = Array.isArray(role.permissions)
        ? role.permissions.flatMap((entry) => {
            const permission = asRecord(entry);
            const code = readString(permission?.code);
            const permissionLevel = readPositiveInteger(permission?.permissionLevel);
            return code && permissionLevel ? [{ code, permissionLevel }] : [];
          })
        : [];
      await bestEffort(`B2B role ${name}`, async () => {
        if (existing && Number(asRecord(existing)?.roleType) !== 2) {
          throw new CatalogRestoreError(`A predefined destination role already uses the name “${name}”.`);
        }
        const response = await b2bApiRequest(
          environment,
          targetId ? `/companies/roles/${targetId}` : "/companies/roles",
          {
            method: targetId ? "PUT" : "POST",
            body: { name, permissions },
            resource: `Company role ${name}`,
          },
        );
        targetId ??= b2bRecordId(asRecord(asRecord(response)?.data), "id", "roleId");
        if (targetId) sourceRoleToTarget.set(sourceId, targetId);
      });
    }
  }

  const sourceCompanies = capturedData(resources.companies);
  const sourceUsers = capturedData(resources.users);
  const destinationCompanies = await fetchB2BCollection(
    environment,
    "/companies?isIncludeExtraFields=1",
    "destination Companies",
  );
  const companyMap = new Map<number, number>();
  if (Array.isArray(sourceCompanies)) {
    for (const value of sourceCompanies) {
      const company = asRecord(value);
      const sourceId = b2bRecordId(company, "companyId", "id");
      const name = readString(company?.companyName ?? company?.name);
      const email = readString(company?.companyEmail ?? company?.email);
      const uuid = readString(company?.uuid);
      if (!company || !sourceId || !name) continue;
      const existing = destinationCompanies.find((candidate) => {
        const record = asRecord(candidate);
        return (uuid && readString(record?.uuid) === uuid) ||
          (email && normalizeText(record?.companyEmail ?? record?.email) === normalizeText(email)) ||
          normalizeText(record?.companyName ?? record?.name) === normalizeText(name);
      });
      let targetId = b2bRecordId(asRecord(existing), "companyId", "id");
      if (targetId) companyMap.set(sourceId, targetId);
      await bestEffort(`B2B Company ${name}`, async () => {
        const body = pick(company, B2B_COMPANY_FIELDS);
        body.companyName ??= name;
        body.companyEmail ??= email;
        body.channelIds = [destinationChannelId];
        if (!targetId) {
          const admin = Array.isArray(sourceUsers)
            ? sourceUsers.map(asRecord).find((user) =>
                b2bRecordId(user, "companyId") === sourceId &&
                (Number(user?.role) === 0 || normalizeText(user?.companyRoleName) === "admin"),
              )
            : null;
          body.adminFirstName = readString(admin?.firstName) || "Demo";
          body.adminLastName = readString(admin?.lastName) || "Administrator";
          body.adminEmail = readString(admin?.email) || email;
          body.adminPhoneNumber = readString(admin?.phoneNumber) || readString(company.companyPhone);
          if (!body.companyEmail || !body.adminEmail || !body.country) {
            throw new CatalogRestoreError(
              "The captured Company lacks the email, administrator, or country fields required for creation.",
            );
          }
        }
        const response = await b2bApiRequest(
          environment,
          targetId ? `/companies/${targetId}` : "/companies",
          {
            method: targetId ? "PUT" : "POST",
            body,
            resource: `Company ${name}`,
          },
        );
        targetId ??= b2bRecordId(asRecord(asRecord(response)?.data), "companyId", "id");
        if (targetId) companyMap.set(sourceId, targetId);
      });
    }
  }

  const destinationUsers = await fetchB2BCollection(
    environment,
    "/users?isIncludeExtraFields=1",
    "destination Company users",
  );
  const userMap = new Map<number, number>();
  if (Array.isArray(sourceUsers)) {
    for (const value of sourceUsers) {
      const user = asRecord(value);
      const sourceId = b2bRecordId(user, "id", "userId");
      const sourceCompanyId = b2bRecordId(user, "companyId");
      const targetCompanyId = sourceCompanyId ? companyMap.get(sourceCompanyId) : null;
      const email = readString(user?.email);
      if (!user || !sourceId || !targetCompanyId || !email) continue;
      const existing = destinationUsers.find(
        (candidate) => normalizeText(asRecord(candidate)?.email) === normalizeText(email),
      );
      let targetId = b2bRecordId(asRecord(existing), "id", "userId");
      if (targetId) userMap.set(sourceId, targetId);
      await bestEffort(`B2B user ${email}`, async () => {
        const body = pick(user, B2B_USER_FIELDS);
        body.companyId = targetCompanyId;
        body.channelIds = [destinationChannelId];
        const sourceRoleId = b2bRecordId(user, "companyRoleId");
        const targetRoleId = sourceRoleId ? sourceRoleToTarget.get(sourceRoleId) : null;
        if (targetRoleId) body.companyRoleId = targetRoleId;
        else if ([0, 1, 2].includes(Number(user.role))) body.role = Number(user.role);
        const response = await b2bApiRequest(
          environment,
          targetId ? `/users/${targetId}` : "/users",
          {
            method: targetId ? "PUT" : "POST",
            body,
            resource: `Company user ${email}`,
          },
        );
        targetId ??= b2bRecordId(asRecord(asRecord(response)?.data), "id", "userId");
        if (targetId) userMap.set(sourceId, targetId);
      });
    }
  }

  const sourceAddresses = capturedData(resources.addresses);
  if (Array.isArray(sourceAddresses)) {
    const destinationAddresses = await fetchB2BCollection(
      environment,
      "/addresses",
      "destination Company addresses",
    );
    for (const value of sourceAddresses) {
      const address = asRecord(value);
      const sourceCompanyId = b2bRecordId(address, "companyId");
      const targetCompanyId = sourceCompanyId ? companyMap.get(sourceCompanyId) : null;
      if (!address || !targetCompanyId) continue;
      const signature = [address.label, address.addressLine1, address.city, address.zipCode]
        .map(normalizeText).join("|");
      const exists = destinationAddresses.some((candidate) => {
        const record = asRecord(candidate);
        return b2bRecordId(record, "companyId") === targetCompanyId &&
          [record?.label, record?.addressLine1, record?.city, record?.zipCode]
            .map(normalizeText).join("|") === signature;
      });
      if (exists) continue;
      await bestEffort(`B2B address ${readString(address.label) || readString(address.addressLine1)}`, () =>
        b2bApiRequest(environment, `/companies/${targetCompanyId}/addresses`, {
          method: "POST",
          body: { ...pick(address, B2B_ADDRESS_FIELDS), companyId: targetCompanyId },
          resource: "Company address",
        }),
      );
    }
  }

  const sourceHierarchies = capturedData(resources.hierarchies);
  if (Array.isArray(sourceHierarchies)) {
    for (const value of sourceHierarchies) {
      const relation = asRecord(value);
      const child = companyMap.get(b2bRecordId(relation, "companyId") ?? 0);
      const parent = companyMap.get(b2bRecordId(relation, "parentCompanyId") ?? 0);
      if (!child || !parent) continue;
      await bestEffort(`B2B Company hierarchy ${parent} → ${child}`, () =>
        b2bApiRequest(environment, `/companies/${child}/parent`, {
          method: "POST",
          body: { parentCompanyId: parent },
          resource: "Company hierarchy",
        }),
      );
    }
  }

  const sourceShoppingLists = capturedData(resources.shoppingLists);
  if (Array.isArray(sourceShoppingLists)) {
    for (const value of sourceShoppingLists) {
      const list = asRecord(value);
      const sourceUserId = b2bRecordId(list, "userId");
      const targetUserId = sourceUserId ? userMap.get(sourceUserId) : null;
      const name = readString(list?.name);
      if (!list || !targetUserId || !name) continue;
      let destinationLists: unknown[];
      try {
        destinationLists = await fetchB2BCollection(
          environment,
          `/shopping-list?userId=${targetUserId}`,
          `destination shopping lists for user ${targetUserId}`,
        );
      } catch (error) {
        warnings.push(`B2B shopping list ${name}: ${error instanceof Error ? error.message : "unable to check the destination"}`);
        continue;
      }
      if (destinationLists.some(
        (candidate) => normalizeText(asRecord(candidate)?.name) === normalizeText(name),
      )) continue;
      const items = Array.isArray(list.items)
        ? list.items.flatMap((entry) => {
            const item = asRecord(entry);
            const sourceProductId = b2bRecordId(item, "productId");
            const targetProductId = sourceProductId
              ? sourceToTargetProduct.get(sourceProductId) ??
                (environment.storeHash === manifest.source.storeHash ? sourceProductId : undefined)
              : undefined;
            return item && targetProductId
              ? [{ ...pick(item, ["quantity", "optionList", "itemId"]), productId: targetProductId }]
              : [];
          })
        : [];
      await bestEffort(`B2B shopping list ${name}`, () =>
        b2bApiRequest(environment, "/shopping-list", {
          method: "POST",
          body: {
            name,
            description: readString(list.description),
            status: [0, 30, 40].includes(Number(list.status)) ? Number(list.status) : 30,
            userId: targetUserId,
            channelId: destinationChannelId,
            items,
          },
          resource: `shopping list ${name}`,
        }),
      );
    }
  }

  if (capturedData(resources.quotes)) {
    warnings.push("B2B quotes were captured with their products and messages but were not recreated because the Management API automatically submits new quotes to buyers and can send notifications.");
  }
  if (capturedData(resources.orders)) {
    warnings.push("B2B order records were captured, but the B2B Orders API cannot create the underlying BigCommerce orders. Existing destination orders were not modified.");
  }
  if (capturedData(resources.invoices) || capturedData(resources.payments)) {
    warnings.push("B2B invoices and payments were captured as financial history and were not replayed in the destination store.");
  }
  if (capturedData(resources.attachments)) {
    warnings.push("B2B Company attachment metadata was captured; binary attachment files were not copied.");
  }
  if (capturedData(resources.salesReps)) {
    warnings.push("B2B sales-representative records were captured but were not reassigned because destination system-user identities are store-specific.");
  }
  if (
    capturedData(resources.companyExtraFields) ||
    capturedData(resources.userExtraFields) ||
    capturedData(resources.addressExtraFields) ||
    capturedData(resources.orderExtraFields) ||
    capturedData(resources.quoteExtraFields)
  ) {
    warnings.push("B2B extra-field definitions and values were captured. Values are restored on Companies, users, and addresses when compatible destination definitions already exist; definitions themselves remain destination-managed.");
  }
  warnings.push("Creating B2B Companies or users can cause BigCommerce to send account or welcome email to newly created administrator and buyer addresses.");
}

async function restoreCatalogTranslations(
  environment: ConnectedEnvironment,
  destinationChannelId: number,
  resource: CapturedConfigurationResource | undefined,
  resourceType: "PRODUCTS" | "CATEGORIES",
  idMap: Map<number, number>,
  warnings: string[],
  bestEffort: (label: string, work: () => Promise<unknown>) => Promise<void>,
) {
  const locales = asRecord(capturedData(resource));
  if (!locales) return;
  let unmapped = 0;
  for (const [localeKey, capturedValue] of Object.entries(locales)) {
    const captured = asRecord(capturedValue);
    const data = asRecord(captured?.data) ?? captured;
    const localeCode = readString(data?.localeCode) || localeKey;
    const edges = data?.edges;
    if (!localeCode || !Array.isArray(edges)) continue;
    const entities = edges.flatMap((edge) => {
      const node = asRecord(asRecord(edge)?.node);
      const sourceResourceId = readString(node?.resourceId);
      const sourceId = readPositiveInteger(sourceResourceId.split("/").at(-1));
      const targetId = sourceId ? idMap.get(sourceId) : undefined;
      const fields = Array.isArray(node?.fields)
        ? node.fields.flatMap((value) => {
            const field = asRecord(value);
            const fieldName = readString(field?.fieldName);
            return fieldName && typeof field?.translation === "string"
              ? [{ fieldName, value: field.translation }]
              : [];
          })
        : [];
      if (!targetId || fields.length === 0) {
        if (fields.length > 0 && sourceId && !targetId) unmapped += 1;
        return [];
      }
      const singular = resourceType === "PRODUCTS" ? "product" : "category";
      return [{ resourceId: `bc/store/${singular}/${targetId}`, fields }];
    });
    for (const batch of chunk(entities, 50)) {
      const entityLiteral = batch.map((entity) =>
        `{ resourceId: ${JSON.stringify(entity.resourceId)}, fields: [${entity.fields.map((field) =>
          `{ fieldName: ${JSON.stringify(field.fieldName)}, value: ${JSON.stringify(field.value)} }`,
        ).join(", ")}] }`,
      ).join(", ");
      await bestEffort(`${resourceType.toLowerCase()} translations for ${localeCode}`, () =>
        graphqlRequest(
          environment,
          `mutation RestoreTranslations { translation { updateTranslations(input: { resourceType: ${resourceType}, channelId: ${JSON.stringify(`bc/store/channel/${destinationChannelId}`)}, localeId: ${JSON.stringify(`bc/store/locale/${localeCode}`)}, entities: [${entityLiteral}] }) { errors { ... on Error { message } } } } }`,
          {},
          `${resourceType.toLowerCase()} translations for ${localeCode}`,
        ),
      );
    }
  }
  if (unmapped > 0) {
    warnings.push(
      `${unmapped} ${resourceType.toLowerCase()} translation record${unmapped === 1 ? "" : "s"} could not be applied because its catalog resource was not mapped in the destination.`,
    );
  }
}

async function restoreConfiguration(
  environment: ConnectedEnvironment,
  destinationChannelId: number,
  manifest: CatalogSnapshotManifestV1,
  groups: SnapshotRestoreGroup[],
  warnings: string[],
  sourceToTargetProduct: Map<number, number>,
  sourceToTargetVariant: Map<number, number>,
  sourceToTargetCategory: Map<number, number>,
  onProgress?: (currentStep: string, stepIndex?: number, totalSteps?: number) => Promise<void>,
) {
  const configuration = manifest.configuration;
  const selected = groups.filter(
    (group): group is Exclude<SnapshotRestoreGroup, "catalog" | "channel"> =>
      group !== "catalog" && group !== "channel",
  );
  let step = 0;
  const total = Math.max(selected.length, 1);
  const bestEffort = async (label: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      warnings.push(
        `${label}: ${error instanceof Error ? error.message.replace(/ The restore may be partially complete\.$/, "") : "restore failed"}`,
      );
    }
  };

  for (const group of selected) {
    step += 1;
    await onProgress?.(
      group === "b2b"
        ? "Restoring B2B Edition Companies, users, roles, and demo records"
        : `Restoring ${group.replaceAll("_", " ")} configuration`,
      groups.includes("catalog") ? total : step,
      total,
    );
    const resources = configuration?.[group]?.resources;
    if (!resources) {
      warnings.push(`${group}: this snapshot version does not contain this configuration group.`);
      continue;
    }
    for (const [resourceKey, resource] of Object.entries(resources)) {
      const expectedMissingTheme =
        resourceKey === "activeTheme" &&
        normalizeText(manifest.catalog.channel.platform) !== "bigcommerce";
      const legacyEmptyCustomerGroups =
        group === "storefront" &&
        resourceKey === "customerGroups" &&
        normalizeText(resource.warning).includes("unexpected end of json input");
      if (resource.warning && !expectedMissingTheme && !legacyEmptyCustomerGroups) {
        warnings.push(`${resource.label}: ${resource.warning}`);
      }
    }

    if (group === "storefront") {
      for (const setting of STOREFRONT_SETTING_ENDPOINTS) {
        const source = asRecord(capturedData(resources[setting.key]));
        if (!source) continue;
        const body = pick(source, setting.fields);
        if (Object.keys(body).length === 0) continue;
        await bestEffort(resources[setting.key]?.label ?? setting.key, () =>
          apiRequest(
            environment,
            `${setting.path}?channel_id=${destinationChannelId}`,
            {
              method: "PUT",
              body,
              resource: resources[setting.key]?.label ?? setting.key,
            },
          ),
        );
      }

      const logo = asRecord(capturedData(resources.logo));
      if (logo) {
        const logoSettings = pick(logo, ["logo_text", "type"]);
        const hasWritableTextLogo = normalizeText(logo.type) === "text" &&
          readString(logo.logo_text).trim().length > 0;
        if (hasWritableTextLogo && Object.keys(logoSettings).length > 0) {
          await bestEffort("Logo settings", () =>
            apiRequest(
              environment,
              `/settings/logo?channel_id=${destinationChannelId}`,
              { method: "PUT", body: logoSettings, resource: "logo settings" },
            ),
          );
        }
        const logoImageUrl = readString(logo.logo_image_url);
        if (normalizeText(logo.type) === "image" && logoImageUrl) {
          await bestEffort("Store logo image", () =>
            uploadStorefrontAsset(
              environment,
              `/settings/logo/image?channel_id=${destinationChannelId}`,
              logoImageUrl,
              "LogoFile",
              "store logo image",
            ),
          );
        }
        const faviconUrl = readString(logo.favicon_url);
        if (faviconUrl) {
          await bestEffort("Storefront favicon", () =>
            uploadStorefrontAsset(
              environment,
              `/settings/favicon/image?channel_id=${destinationChannelId}`,
              faviconUrl,
              "FaviconFile",
              "storefront favicon",
            ),
          );
        }
      }

      const customerSettings = asRecord(capturedData(resources.customerPrivacy));
      if (customerSettings) {
        let targetCustomerGroups: unknown = [];
        try {
          targetCustomerGroups = await apiRequestV2(
            environment,
            "/customer_groups?limit=250",
            { resource: "destination customer groups" },
          );
        } catch (error) {
          warnings.push(
            `Customer privacy: ${error instanceof Error ? error.message : "destination customer groups could not be loaded"}`,
          );
        }
        const body = storefrontCustomerSettingsInput(
          customerSettings,
          capturedData(resources.customerGroups),
          targetCustomerGroups,
          warnings,
        );
        if (Object.keys(body).length > 0) {
          await bestEffort("Customer privacy and group settings", () =>
            apiRequest(
              environment,
              `/customers/settings/channels/${destinationChannelId}`,
              {
                method: "PUT",
                body,
                resource: "customer privacy and group settings",
              },
            ),
          );
        }
      }
      continue;
    }

    if (group === "experience") {
      const endpoints: Record<string, string> = {
        checkout: `/checkouts/settings/channels/${destinationChannelId}`,
        cart: `/carts/settings/channels/${destinationChannelId}`,
        customer: `/customers/settings/channels/${destinationChannelId}`,
        order: `/orders/settings/channels/${destinationChannelId}`,
        abandonedCart: `/abandoned-carts/settings/channels/${destinationChannelId}`,
      };
      for (const [key, endpoint] of Object.entries(endpoints)) {
        const body = writableObject(capturedData(resources[key]));
        if (body) {
          await bestEffort(resources[key]?.label ?? key, () =>
            apiRequest(environment, endpoint, {
              method: "PUT",
              body,
              resource: resources[key]?.label ?? key,
            }),
          );
        }
      }
      continue;
    }

    if (group === "pricing") {
      const capturedCurrencies = writableObject(capturedData(resources.currencyAssignments));
      const currencies = capturedCurrencies
          ? await prepareCurrencyAssignments(
            environment,
            destinationChannelId,
            resources,
            capturedCurrencies,
            manifest.store,
            warnings,
          )
        : null;
      if (currencies) {
        await bestEffort("Currency assignments", () =>
          apiRequest(environment, `/channels/${destinationChannelId}/currency-assignments`, {
            method: "PUT",
            body: currencies,
            resource: "currency assignments",
          }),
        );
      }
      const assignments = capturedData(resources.priceListAssignments);
      const sourcePriceLists = capturedData(resources.priceLists);
      const priceListIdMap = new Map<number, number>();
      if (Array.isArray(sourcePriceLists)) {
        const targetPriceLists = (
          await fetchCollection(environment, "/pricelists", "destination price lists")
        ).flatMap((value) => asRecord(value) ? [asRecord(value)!] : []);
        for (const value of sourcePriceLists) {
          const source = asRecord(value);
          const sourceId = readPositiveInteger(source?.id);
          const name = readString(source?.name);
          if (!source || !sourceId || !name) continue;
          const target = targetPriceLists.find(
            (candidate) => normalizeText(candidate.name) === normalizeText(name),
          );
          let targetId = readPositiveInteger(target?.id);
          await bestEffort(`Price list ${name}`, async () => {
            if (!targetId) {
              const body = writableObject(source);
              const payload = await apiRequest(environment, "/pricelists", {
                method: "POST",
                body,
                resource: `price list ${name}`,
              });
              targetId = readPositiveInteger(asRecord(asRecord(payload)?.data)?.id);
            }
            if (targetId) priceListIdMap.set(sourceId, targetId);
          });
        }
      }
      if (Array.isArray(assignments)) {
        for (const value of assignments) {
          const assignment = asRecord(value);
          const sourcePriceListId = readPositiveInteger(assignment?.price_list_id);
          const priceListId = sourcePriceListId
            ? priceListIdMap.get(sourcePriceListId) ??
              (environment.storeHash === manifest.source.storeHash ? sourcePriceListId : undefined)
            : undefined;
          if (!sourcePriceListId || !priceListId) continue;
          await bestEffort(`Price-list ${sourcePriceListId} assignment`, () =>
            apiRequest(environment, "/pricelists/assignments", {
              method: "PUT",
              body: [{
                price_list_id: priceListId,
                channel_id: destinationChannelId,
                ...(readPositiveInteger(assignment?.customer_group_id)
                  ? { customer_group_id: Number(assignment!.customer_group_id) }
                  : {}),
              }],
              resource: `price-list ${priceListId} assignment`,
            }),
          );
        }
      }
      const recordsByPriceList = asRecord(capturedData(resources.priceListRecords));
      if (recordsByPriceList) {
        let unmappedRecords = 0;
        for (const [sourcePriceListKey, values] of Object.entries(recordsByPriceList)) {
          const sourcePriceListId = readPositiveInteger(sourcePriceListKey);
          const targetPriceListId = sourcePriceListId
            ? priceListIdMap.get(sourcePriceListId) ??
              (environment.storeHash === manifest.source.storeHash ? sourcePriceListId : undefined)
            : undefined;
          if (!targetPriceListId || !Array.isArray(values)) continue;
          const records = values.flatMap((value) => {
            const source = asRecord(value);
            const sourceVariantId = readPositiveInteger(source?.variant_id);
            const targetVariantId = sourceVariantId
              ? sourceToTargetVariant.get(sourceVariantId) ??
                (environment.storeHash === manifest.source.storeHash ? sourceVariantId : undefined)
              : undefined;
            if (!source || !targetVariantId) {
              unmappedRecords += 1;
              return [];
            }
            return [{
              variant_id: targetVariantId,
              ...pick(source, PRICE_LIST_RECORD_FIELDS),
            }];
          });
          for (const batch of chunk(records, 250)) {
            await bestEffort(`Price-list ${targetPriceListId} records`, () =>
              apiRequest(environment, `/pricelists/${targetPriceListId}/records`, {
                method: "PUT",
                body: batch,
                resource: `price-list ${targetPriceListId} records`,
              }),
            );
          }
        }
        if (unmappedRecords > 0) {
          warnings.push(
            `${unmappedRecords} price-list record${unmappedRecords === 1 ? "" : "s"} could not be restored because the source variant had no SKU/base-variant match in the destination.`,
          );
        }
      }
      continue;
    }

    if (group === "shipping") {
      const body = writableObject(capturedData(resources.channelShipping));
      if (body) {
        await bestEffort("Channel shipping settings", () =>
          apiRequest(environment, `/shipping/settings/channels/${destinationChannelId}`, {
            method: "PUT",
            body,
            resource: "channel shipping settings",
          }),
        );
      }
      await reconcileShippingConfiguration(
        environment,
        destinationChannelId,
        resources,
        bestEffort,
      );
      continue;
    }

    if (group === "tax") {
      const zoneMap = await reconcileTaxConfiguration(environment, resources, bestEffort);
      const settings = writableObject(capturedData(resources.taxSettings));
      if (settings) {
        const priceDisplaySettings = asRecord(settings.price_display_settings);
        if (priceDisplaySettings && "show_inclusive_in_control_panel" in priceDisplaySettings) {
          const legacyValue = priceDisplaySettings.show_inclusive_in_control_panel;
          delete priceDisplaySettings.show_inclusive_in_control_panel;
          if (!("control_panel_price_display_strategy" in priceDisplaySettings)) {
            priceDisplaySettings.control_panel_price_display_strategy = legacyValue
              ? "INCLUSIVE"
              : "EXCLUSIVE";
          }
        }
        for (const key of ["guest_shopper_tax_zone_id", "store_tax_zone_id"]) {
          const sourceId = readPositiveInteger(settings[key]);
          if (sourceId && zoneMap.has(sourceId)) settings[key] = zoneMap.get(sourceId);
        }
        await bestEffort("Tax settings", () =>
          apiRequest(environment, "/tax/settings", {
            method: "PUT",
            body: settings,
            resource: "tax settings",
          }),
        );
      }
      continue;
    }

    if (group === "inventory") {
      const settings = writableObject(capturedData(resources.inventorySettings));
      if (settings) {
        await bestEffort("Inventory settings", () =>
          apiRequest(environment, "/settings/inventory", {
            method: "PUT",
            body: settings,
            resource: "inventory settings",
          }),
        );
      }
      if (capturedData(resources.locations)) {
        warnings.push("Inventory locations were captured, but existing locations were not modified because location identity and fulfillment mappings are store-wide. Product and variant stock is restored for newly created catalog records.");
      }
      continue;
    }

    if (group === "b2b") {
      await bestEffort("B2B Edition", () =>
        reconcileB2BConfiguration(
          environment,
          destinationChannelId,
          manifest,
          resources,
          warnings,
          bestEffort,
          sourceToTargetProduct,
        ),
      );
      continue;
    }

    if (group === "localization") {
      const storeLocale = writableObject(capturedData(resources.storeLocale));
      const storeCountry = readString(storeLocale?.store_country);
      if (storeCountry) {
        await bestEffort("Channel default country", () =>
          apiRequest(
            environment,
            `/settings/store/locale?channel_id=${destinationChannelId}`,
            {
              method: "PUT",
              body: { store_country: storeCountry },
              resource: "channel default country",
            },
          ),
        );
      }
      const localePayload = asRecord(capturedData(resources.channelLocales));
      const localeRoot = asRecord(localePayload?.data) ?? localePayload;
      const localeEdges = asRecord(asRecord(localeRoot?.store)?.locales)?.edges;
      if (Array.isArray(localeEdges)) {
        await bestEffort("Channel locales", async () => {
          const channelId = `bc/store/channel/${destinationChannelId}`;
          const destinationPayload = await graphqlRequest(
            environment,
            `query DestinationLocales($channelId: ID!) { store { locales(input: { channelId: $channelId }) { edges { node { code status isDefault } } } } }`,
            { channelId },
            "destination channel locales",
          );
          const destinationEdges = asRecord(
            asRecord(asRecord(asRecord(destinationPayload)?.data)?.store)?.locales,
          )?.edges;
          const destinationLocales = Array.isArray(destinationEdges)
            ? destinationEdges.flatMap((edge) => {
                const locale = asRecord(asRecord(edge)?.node);
                const code = readString(locale?.code);
                return code
                  ? [{ code: code.toLowerCase(), isDefault: Boolean(locale?.isDefault) }]
                  : [];
              })
            : [];
          const destinationCodes = new Set(
            destinationLocales.map((locale) => locale.code),
          );
          const destinationDefaultCode = destinationLocales.find(
            (locale) => locale.isDefault,
          )?.code;
          const sourceLocales = localeEdges.flatMap((edge) => {
            const locale = asRecord(asRecord(edge)?.node);
            const code = readString(locale?.code);
            return code ? [{
              code,
              status: readString(locale?.status).toUpperCase() === "ACTIVE"
                ? "ACTIVE"
                : "INACTIVE",
              isDefault: Boolean(locale?.isDefault),
            }] : [];
          });

          for (const locale of sourceLocales) {
            if (destinationCodes.has(locale.code.toLowerCase())) continue;
            if (destinationCodes.size >= 5) {
              warnings.push(
                `Locale ${locale.code} was not added because BigCommerce allows at most five locales per channel.`,
              );
              continue;
            }
            await graphqlRequest(
              environment,
              `mutation AddLocale($channelId: ID!, $code: String!) { locale { addLocale(input: { channelId: $channelId, code: $code, status: ${locale.status} }) { locale { code } errors { ... on Error { message } } } } }`,
              { channelId, code: locale.code },
              `locale ${locale.code}`,
            );
            destinationCodes.add(locale.code.toLowerCase());
          }

          const defaultLocale = sourceLocales.find((locale) => locale.isDefault);
          const defaultLocaleCode = defaultLocale?.code.toLowerCase();
          if (
            defaultLocale &&
            defaultLocaleCode &&
            destinationCodes.has(defaultLocaleCode) &&
            destinationDefaultCode !== defaultLocaleCode
          ) {
            await graphqlRequest(
              environment,
              `mutation MakeLocaleDefault($channelId: ID!, $code: String!) { locale { updateLocale(input: { channelId: $channelId, code: $code, status: ACTIVE, isDefault: true }) { locale { code } errors { ... on Error { message } } } } }`,
              { channelId, code: defaultLocale.code },
              `default locale ${defaultLocale.code}`,
            );
          }
        });
      }
      await restoreCatalogTranslations(
        environment,
        destinationChannelId,
        resources.productTranslations,
        "PRODUCTS",
        sourceToTargetProduct,
        warnings,
        bestEffort,
      );
      await restoreCatalogTranslations(
        environment,
        destinationChannelId,
        resources.categoryTranslations,
        "CATEGORIES",
        sourceToTargetCategory,
        warnings,
        bestEffort,
      );
      if (capturedData(resources.activeTheme)) {
        const activeTheme = asRecord(capturedData(resources.activeTheme));
        const configurations = capturedData(resources.themeConfiguration);
        const configuration = Array.isArray(configurations)
          ? asRecord(configurations[0])
          : null;
        const themeUuid = readString(activeTheme?.active_theme_uuid);
        const configurationId =
          readString(activeTheme?.active_theme_configuration_uuid) ||
          readString(configuration?.uuid);
        const variationId = readString(configuration?.variation_id);
        if (themeUuid && configurationId && variationId) {
          await bestEffort("Active theme", () =>
            apiRequest(environment, "/themes/actions/activate", {
              method: "POST",
              body: {
                theme_uuid: themeUuid,
                variation_id: variationId,
                configuration_id: configurationId,
                channel_id: destinationChannelId,
              },
              resource: "active theme",
            }),
          );
        }
      }
    }
  }
}

async function resolveDestination(
  userId: string,
  environmentId: number,
  channelId: number,
) {
  const environment = await getBigCommerceEnvironmentConnection(
    userId,
    environmentId,
  );

  if (!environment) {
    throw new CatalogRestoreError("The selected destination environment was not found.");
  }

  if (!environment.accessToken) {
    throw new CatalogRestoreError(
      "The destination token could not be decrypted. Re-save it in Settings.",
    );
  }

  const connected = { ...environment, accessToken: environment.accessToken };
  const payload = await apiRequest(connected, `/channels/${channelId}`, {
    resource: "channel",
  });
  const channel = asRecord(asRecord(payload)?.data);

  if (
    readPositiveInteger(channel?.id) !== channelId ||
    !readString(channel?.name) ||
    normalizeText(channel?.status) === "deleted"
  ) {
    throw new CatalogRestoreError(
      "The selected destination channel is missing, deleted, or invalid.",
    );
  }

  return { environment: connected, channelName: readString(channel?.name) };
}

const CATEGORY_FIELDS = [
  "description",
  "views",
  "sort_order",
  "page_title",
  "meta_keywords",
  "meta_description",
  "layout_file",
  "image_url",
  "is_visible",
  "search_keywords",
  "default_product_sort",
  "url",
] as const;

function categoryDepth(
  category: SnapshotCategory,
  byId: Map<number, SnapshotCategory>,
  seen = new Set<number>(),
): number {
  const id = readPositiveInteger(category.data.category_id);
  const parentId = readPositiveInteger(category.data.parent_id);

  if (!id || !parentId || !byId.has(parentId) || seen.has(id)) {
    return 0;
  }

  seen.add(id);
  return 1 + categoryDepth(byId.get(parentId)!, byId, seen);
}

async function ensureDestinationTree(
  environment: ConnectedEnvironment,
  channelId: number,
  channelName: string,
) {
  const trees = await fetchCollection(
    environment,
    `/catalog/trees?channel_id:in=${channelId}`,
    "category trees",
  );
  const tree = trees.map(asRecord).find((value) => readPositiveInteger(value?.id));
  const existingId = readPositiveInteger(tree?.id);

  if (existingId) {
    return existingId;
  }

  const payload = await apiRequest(environment, "/catalog/trees", {
    method: "PUT",
    body: [{ name: `${channelName} Catalog`, channels: [channelId] }],
    resource: "category tree",
  });
  const created = readDataArray(payload, "category tree")[0];
  const treeId = readPositiveInteger(asRecord(created)?.id);

  if (!treeId) {
    throw new CatalogRestoreError(
      "BigCommerce created a category tree without returning its ID.",
    );
  }

  return treeId;
}

type CategoryRestoreState = {
  sourceToTarget: Map<number, number>;
  created: number;
  updated: number;
};

async function mapExistingCatalogForTranslations(
  environment: ConnectedEnvironment,
  channelId: number,
  manifest: CatalogSnapshotManifestV1,
  categoryMap: Map<number, number>,
  productMap: Map<number, number>,
  variantMap?: Map<number, number>,
) {
  const trees = await fetchCollection(
    environment,
    `/catalog/trees?channel_id:in=${channelId}`,
    "destination category trees for translations",
  );
  const treeId = trees
    .map(asRecord)
    .map((tree) => readPositiveInteger(tree?.id))
    .find((id): id is number => Boolean(id));

  if (treeId) {
    const targetCategories = (
      await fetchCollection(
        environment,
        `/catalog/trees/categories?tree_id:in=${treeId}`,
        "destination categories for translations",
      )
    ).flatMap((value) => {
      const record = asRecord(value);
      return record ? [record] : [];
    });
    const sourceById = new Map<number, SnapshotCategory>();
    for (const category of manifest.catalog.categories) {
      const sourceId = readPositiveInteger(category.data.category_id);
      if (sourceId) sourceById.set(sourceId, category);
    }
    const usedTargetIds = new Set(categoryMap.values());
    const orderedCategories = [...manifest.catalog.categories].sort(
      (left, right) =>
        categoryDepth(left, sourceById) - categoryDepth(right, sourceById),
    );

    for (const sourceCategory of orderedCategories) {
      const sourceId = readPositiveInteger(sourceCategory.data.category_id);
      if (!sourceId || categoryMap.has(sourceId)) continue;
      const sourcePath = normalizePath(sourceCategory.data.url);
      const sourceParentId = readPositiveInteger(sourceCategory.data.parent_id);
      const targetParentId = sourceParentId
        ? categoryMap.get(sourceParentId) ?? 0
        : 0;
      const matches = targetCategories.filter((candidate) => {
        const candidateId = readPositiveInteger(candidate.category_id);
        if (!candidateId || usedTargetIds.has(candidateId)) return false;
        const candidatePath = normalizePath(candidate.url);
        return sourcePath
          ? candidatePath === sourcePath
          : normalizeText(candidate.name) === normalizeText(sourceCategory.data.name) &&
              Number(candidate.parent_id) === targetParentId;
      });
      const targetId = matches.length === 1
        ? readPositiveInteger(matches[0].category_id)
        : null;
      if (targetId) {
        categoryMap.set(sourceId, targetId);
        usedTargetIds.add(targetId);
      }
    }
  }

  const targetProducts = (
    await fetchCollection(
      environment,
      "/catalog/products?include=variants",
      "destination products for translations",
    )
  ).flatMap((value) => {
    const record = asRecord(value);
    return record ? [record] : [];
  });
  const usedTargetProductIds = new Set(productMap.values());

  for (const sourceRecord of manifest.catalog.products) {
    const sourceId = readPositiveInteger(sourceRecord.data.id);
    if (!sourceId || productMap.has(sourceId)) continue;
    const sourceKey = productMatchKey(sourceRecord.data);
    const matches = targetProducts.filter((target) => {
      const targetId = readPositiveInteger(target.id);
      if (!targetId || usedTargetProductIds.has(targetId)) return false;
      const targetKey = productMatchKey(target);
      return (
        [...sourceKey.skus].some((sku) => targetKey.skus.has(sku)) ||
        Boolean(sourceKey.slug && targetKey.slug === sourceKey.slug)
      );
    });
    const targetId = matches.length === 1
      ? readPositiveInteger(matches[0].id)
      : null;
    if (targetId) {
      productMap.set(sourceId, targetId);
      usedTargetProductIds.add(targetId);
      if (variantMap) {
        for (const [sourceVariantId, targetVariantId] of mapExistingVariants(
          sourceRecord,
          matches[0],
        )) {
          variantMap.set(sourceVariantId, targetVariantId);
        }
      }
    }
  }
}

async function reconcileCategories(
  environment: ConnectedEnvironment,
  channelId: number,
  channelName: string,
  sourceCategories: SnapshotCategory[],
): Promise<CategoryRestoreState> {
  const treeId = await ensureDestinationTree(environment, channelId, channelName);
  const targetCategories = (
    await fetchCollection(
      environment,
      `/catalog/trees/categories?tree_id:in=${treeId}`,
      "destination categories",
    )
  ).flatMap((value) => {
    const record = asRecord(value);
    return record ? [record] : [];
  });
  const sourceById = new Map<number, SnapshotCategory>();

  for (const category of sourceCategories) {
    const id = readPositiveInteger(category.data.category_id);
    if (id) sourceById.set(id, category);
  }

  const ordered = [...sourceCategories].sort(
    (left, right) =>
      categoryDepth(left, sourceById) - categoryDepth(right, sourceById),
  );
  const availableTargets = new Set(targetCategories);
  const sourceToTarget = new Map<number, number>();
  let created = 0;
  let updated = 0;

  for (const sourceCategory of ordered) {
    const source = sourceCategory.data;
    const sourceId = readPositiveInteger(source.category_id);
    const name = readString(source.name).trim();
    const sourceParentId = readPositiveInteger(source.parent_id);
    const parentId = sourceParentId
      ? sourceToTarget.get(sourceParentId) ?? 0
      : 0;

    if (!sourceId || !name) {
      throw new CatalogRestoreError("The snapshot contains an invalid category.");
    }

    const sourcePath = normalizePath(source.url);
    const match = [...availableTargets].find((candidate) => {
      const candidatePath = normalizePath(candidate.url);
      return sourcePath
        ? candidatePath === sourcePath
        : normalizeText(candidate.name) === normalizeText(name) &&
            Number(candidate.parent_id) === parentId;
    });
    const base = { name, parent_id: parentId, tree_id: treeId, ...pick(source, CATEGORY_FIELDS) };

    if (match) {
      const categoryId = readPositiveInteger(match.category_id);
      if (!categoryId) {
        throw new CatalogRestoreError("A destination category has an invalid ID.");
      }

      await apiRequest(environment, "/catalog/trees/categories", {
        method: "PUT",
        body: [{ category_id: categoryId, ...base }],
        resource: `category ${name}`,
      });
      sourceToTarget.set(sourceId, categoryId);
      availableTargets.delete(match);
      updated += 1;
    } else {
      const payload = await apiRequest(environment, "/catalog/trees/categories", {
        method: "POST",
        body: [base],
        resource: `category ${name}`,
      });
      const createdCategory = readDataArray(payload, "created category")[0];
      const categoryId = readPositiveInteger(asRecord(createdCategory)?.category_id);

      if (!categoryId) {
        throw new CatalogRestoreError(`BigCommerce did not return the ID for category ${name}.`);
      }

      sourceToTarget.set(sourceId, categoryId);
      created += 1;
    }
  }

  for (const sourceCategory of sourceCategories) {
    const sourceId = readPositiveInteger(sourceCategory.data.category_id);
    const targetId = sourceId ? sourceToTarget.get(sourceId) : undefined;

    if (targetId) {
      await syncMetafields(
        environment,
        `/catalog/categories/${targetId}/metafields`,
        sourceCategory.metafields,
        `metafields for category ${readString(sourceCategory.data.name) || targetId}`,
      );
    }
  }

  return {
    sourceToTarget,
    created,
    updated,
  };
}

const PRODUCT_FIELDS = [
  "name", "type", "sku", "description", "weight", "width", "depth", "height",
  "price", "cost_price", "retail_price", "sale_price", "map_price", "product_tax_code",
  "inventory_level", "inventory_warning_level", "inventory_tracking",
  "fixed_cost_shipping_price", "is_free_shipping", "is_visible", "is_featured",
  "warranty", "bin_picking_number", "upc", "search_keywords", "availability",
  "availability_description", "gift_wrapping_options_type", "gift_wrapping_options_list",
  "sort_order", "condition", "is_condition_shown", "order_quantity_minimum",
  "order_quantity_maximum", "page_title", "meta_keywords", "meta_description",
  "preorder_release_date", "preorder_message", "is_preorder_only", "is_price_hidden",
  "price_hidden_label", "custom_url", "open_graph_type", "open_graph_title",
  "open_graph_description", "open_graph_use_meta_description", "open_graph_use_product_name",
  "open_graph_use_image", "gtin", "mpn",
] as const;

const VARIANT_FIELDS = [
  "sku", "cost_price", "price", "sale_price", "retail_price", "weight", "width",
  "height", "depth", "is_free_shipping", "fixed_cost_shipping_price",
  "purchasing_disabled", "purchasing_disabled_message", "upc", "inventory_level",
  "inventory_warning_level", "bin_picking_number", "mpn", "gtin", "image_url",
] as const;

function sourceProductCategoryIds(
  product: JsonRecord,
  categoryMap: Map<number, number>,
) {
  return Array.isArray(product.categories)
    ? product.categories.flatMap((value) => {
        const sourceId = readPositiveInteger(value);
        const targetId = sourceId ? categoryMap.get(sourceId) : undefined;
        return targetId ? [targetId] : [];
      })
    : [];
}

function imageInput(value: unknown) {
  const image = asRecord(value);
  if (!image) return null;
  const imageUrl =
    readString(image.image_url) ||
    readString(image.url_zoom) ||
    readString(image.url_standard) ||
    readString(image.url_thumbnail);

  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // BigCommerce validates this field as a public URL with a short maximum
    // length. Store-generated CDN query strings are not needed to download
    // the image and can make an otherwise valid source URL fail validation.
    url.search = "";
    url.hash = "";
    const normalizedUrl = url.toString();
    if (normalizedUrl.length > 255) return null;

    return {
      image_url: normalizedUrl,
      is_thumbnail: Boolean(image.is_thumbnail),
      sort_order: Number(image.sort_order) || 0,
      description: readString(image.description),
    };
  } catch {
    return null;
  }
}

function productMatchKey(product: JsonRecord) {
  const skus = new Set<string>();
  const baseSku = normalizeText(product.sku);
  if (baseSku) skus.add(baseSku);
  if (Array.isArray(product.variants)) {
    for (const value of product.variants) {
      const sku = normalizeText(asRecord(value)?.sku);
      if (sku) skus.add(sku);
    }
  }
  const slug = normalizePath(product.custom_url);
  return { skus, slug };
}

async function resolveTaxClassMap(environment: ConnectedEnvironment) {
  const response = await fetch(
    `${API_BASE_URL}/${encodeURIComponent(environment.storeHash)}/v2/tax_classes`,
    {
      headers: { Accept: "application/json", "X-Auth-Token": environment.accessToken },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) return [];
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? payload.flatMap((value) => {
    const record = asRecord(value);
    return record ? [record] : [];
  }) : [];
}

function metafieldKey(value: JsonRecord) {
  return `${readString(value.namespace)}\u0000${readString(value.key)}`;
}

async function syncMetafields(
  environment: ConnectedEnvironment,
  path: string,
  sourceValues: unknown[],
  resource: string,
) {
  if (sourceValues.length === 0) return;
  const existing = (await fetchCollection(environment, path, resource)).flatMap((value) => {
    const record = asRecord(value);
    return record ? [record] : [];
  });
  const existingByKey = new Map(existing.map((value) => [metafieldKey(value), value]));

  for (const value of sourceValues) {
    const source = asRecord(value);
    if (!source || !readString(source.namespace) || !readString(source.key)) continue;
    const target = existingByKey.get(metafieldKey(source));
    // resource_type/resource_id/owner_client_id and timestamps are response-only.
    const body = pick(source, ["namespace", "key", "value", "description", "permission_set"]);
    const targetId = readPositiveInteger(target?.id);

    await apiRequest(environment, targetId ? `${path}/${targetId}` : path, {
      method: targetId ? "PUT" : "POST",
      body,
      resource,
    });
  }
}

async function syncImages(
  environment: ConnectedEnvironment,
  productId: number,
  targetImages: unknown[],
  sourceImages: unknown[],
) {
  // Upload first so a rejected source URL cannot leave the product without
  // its previous images. Invalid/rejected images are skipped; the rest of the
  // catalog restore remains useful and can be retried after fixing the URL.
  let uploaded = 0;
  for (const value of sourceImages) {
    const body = imageInput(value);
    if (body) {
      try {
        await apiRequest(environment, `/catalog/products/${productId}/images`, {
          method: "POST",
          body,
          resource: `images for product ${productId}`,
        });
        uploaded += 1;
      } catch (error) {
        if (!(error instanceof CatalogRestoreError)) throw error;
      }
    }
  }

  if (sourceImages.length > 0 && uploaded === 0) return;

  for (const value of targetImages) {
    const imageId = readPositiveInteger(asRecord(value)?.id);
    if (imageId) {
      await apiRequest(environment, `/catalog/products/${productId}/images/${imageId}`, {
        method: "DELETE",
        resource: `images for product ${productId}`,
      });
    }
  }
}

async function loadProduct(
  environment: ConnectedEnvironment,
  productId: number,
) {
  const payload = await apiRequest(
    environment,
    `/catalog/products/${productId}?include=${PRODUCT_INCLUDES}`,
    { resource: `product ${productId}` },
  );
  const product = asRecord(asRecord(payload)?.data);

  if (!product) {
    throw new CatalogRestoreError(
      `BigCommerce returned an unexpected response for product ${productId}.`,
    );
  }

  return product;
}

function optionInput(value: unknown) {
  const option = asRecord(value);
  if (!option) return null;
  const displayName = readString(option.display_name);
  const type = readString(option.type);
  const values = Array.isArray(option.option_values)
    ? option.option_values.flatMap((value, index) => {
        const record = asRecord(value);
        const label = readString(record?.label);
        return label
          ? [{
              label,
              sort_order: Number(record?.sort_order) || index,
              is_default: Boolean(record?.is_default),
              ...(asRecord(record?.value_data)
                ? { value_data: record!.value_data }
                : {}),
            }]
          : [];
      })
    : [];

  if (!displayName || !type || values.length === 0) return null;
  return {
    display_name: displayName,
    type,
    sort_order: Number(option.sort_order) || 0,
    ...(asRecord(option.config) ? { config: option.config } : {}),
    option_values: values,
  };
}

function modifierInput(value: unknown) {
  const modifier = asRecord(value);
  if (!modifier) return null;
  const displayName = readString(modifier.display_name);
  const type = readString(modifier.type);

  if (!displayName || !type) return null;

  const optionValues = Array.isArray(modifier.option_values)
    ? modifier.option_values.flatMap((value, index) => {
      const record = asRecord(value);
      const label = readString(record?.label);
      const adjusters = asRecord(record?.adjusters);
      const priceAdjuster = asRecord(adjusters?.price);
        return label
          ? [{
              label,
              sort_order: Number(record?.sort_order) || index,
              is_default: Boolean(record?.is_default),
              ...(asRecord(record?.value_data)
                ? { value_data: record!.value_data }
                : {}),
              ...(Number.isFinite(Number(priceAdjuster?.adjuster_value))
                ? { adjusters: record!.adjusters }
                : {}),
            }]
          : [];
      })
    : [];

  return {
    display_name: displayName,
    type,
    required: Boolean(modifier.required),
    sort_order: Number(modifier.sort_order) || 0,
    ...(asRecord(modifier.config) ? { config: modifier.config } : {}),
    ...(optionValues.length > 0 ? { option_values: optionValues } : {}),
  };
}

async function replaceProductChildren(
  environment: ConnectedEnvironment,
  productId: number,
  target: JsonRecord,
  source: JsonRecord,
) {
  const resources = [
    {
      key: "custom_fields",
      path: "custom-fields",
      fields: ["name", "value"] as const,
    },
    {
      key: "bulk_pricing_rules",
      path: "bulk-pricing-rules",
      fields: ["quantity_min", "quantity_max", "type", "amount"] as const,
    },
    {
      key: "videos",
      path: "videos",
      fields: ["title", "description", "sort_order", "type", "video_id"] as const,
    },
  ];

  for (const resource of resources) {
    const rawTargetValues = target[resource.key];
    const rawSourceValues = source[resource.key];
    const targetValues = Array.isArray(rawTargetValues) ? rawTargetValues : [];
    const sourceValues = Array.isArray(rawSourceValues) ? rawSourceValues : [];

    for (const value of targetValues) {
      const id = readPositiveInteger(asRecord(value)?.id);
      if (id) {
        await apiRequest(
          environment,
          `/catalog/products/${productId}/${resource.path}/${id}`,
          {
            method: "DELETE",
            resource: `${resource.key.replaceAll("_", " ")} for product ${productId}`,
          },
        );
      }
    }

    for (const value of sourceValues) {
      const record = asRecord(value);
      if (record) {
        await apiRequest(
          environment,
          `/catalog/products/${productId}/${resource.path}`,
          {
            method: "POST",
            body: pick(record, resource.fields),
            resource: `${resource.key.replaceAll("_", " ")} for product ${productId}`,
          },
        );
      }
    }
  }

  const targetModifiers = Array.isArray(target.modifiers) ? target.modifiers : [];
  for (const value of targetModifiers) {
    const id = readPositiveInteger(asRecord(value)?.id);
    if (id) {
      await apiRequest(
        environment,
        `/catalog/products/${productId}/modifiers/${id}`,
        { method: "DELETE", resource: `modifiers for product ${productId}` },
      );
    }
  }

  const sourceModifiers = Array.isArray(source.modifiers) ? source.modifiers : [];
  for (const value of sourceModifiers) {
    const body = modifierInput(value);
    if (body) {
      await apiRequest(environment, `/catalog/products/${productId}/modifiers`, {
        method: "POST",
        body,
        resource: `modifiers for product ${productId}`,
      });
    }
  }
}

async function rebuildVariants(
  environment: ConnectedEnvironment,
  productId: number,
  target: JsonRecord,
  sourceRecord: SnapshotProduct,
) {
  const targetVariants = Array.isArray(target.variants)
    ? target.variants.flatMap((value) => {
        const record = asRecord(value);
        return record ? [record] : [];
      })
    : [];
  const sourceVariants = Array.isArray(sourceRecord.data.variants)
    ? sourceRecord.data.variants.flatMap((value) => {
        const record = asRecord(value);
        return record ? [record] : [];
    })
    : [];
  const declaredTargetBaseId = readPositiveInteger(target.base_variant_id);
  const targetBase =
    targetVariants.find((variant) => Number(variant.id) === declaredTargetBaseId) ??
    targetVariants.find(
      (variant) =>
        !Array.isArray(variant.option_values) || variant.option_values.length === 0,
    ) ??
    targetVariants[0];
  const targetBaseId = readPositiveInteger(targetBase?.id);

  const targetOptions = Array.isArray(target.options) ? target.options : [];
  const createdOptions = new Map<string, JsonRecord>();
  for (const option of targetOptions) {
    const record = asRecord(option);
    const displayName = normalizeText(record?.display_name);
    if (displayName && record) createdOptions.set(displayName, record);
  }
  const sourceOptions = Array.isArray(sourceRecord.data.options)
    ? sourceRecord.data.options
    : [];

  for (const value of sourceOptions) {
    const body = optionInput(value);
    if (!body) continue;
    const sourceOption = asRecord(value);
    const existingOption = createdOptions.get(
      normalizeText(sourceOption?.display_name),
    );
    if (existingOption) continue;
    const payload = await apiRequest(
      environment,
      `/catalog/products/${productId}/options`,
      { method: "POST", body, resource: `variant options for product ${productId}` },
    );
    const created = asRecord(asRecord(payload)?.data);
    if (created) createdOptions.set(normalizeText(created.display_name), created);
  }

  const mapOptionValues = (sourceVariant: JsonRecord) => {
    const optionValues = Array.isArray(sourceVariant.option_values)
      ? sourceVariant.option_values
      : [];
    const mappedValues = optionValues.flatMap((value) => {
      const sourceValue = asRecord(value);
      const option = createdOptions.get(normalizeText(sourceValue?.option_display_name));
      const optionId = readPositiveInteger(option?.id);
      const values = Array.isArray(option?.option_values) ? option.option_values : [];
      const targetValue = values
        .map(asRecord)
        .find(
          (candidate) =>
            normalizeText(candidate?.label) === normalizeText(sourceValue?.label),
        );
      const valueId = readPositiveInteger(targetValue?.id);
      return optionId && valueId ? [{ option_id: optionId, id: valueId }] : [];
    });

    if (mappedValues.length !== optionValues.length) {
      throw new CatalogRestoreError(
        `Could not map every option value for variant ${readString(sourceVariant.sku) || readPositiveInteger(sourceVariant.id) || "unknown"}.`,
      );
    }

    return mappedValues;
  };
  const declaredSourceBaseId = readPositiveInteger(sourceRecord.data.base_variant_id);
  const sourceBase =
    sourceVariants.find((variant) => Number(variant.id) === declaredSourceBaseId) ??
    sourceVariants.find(
      (variant) =>
        !Array.isArray(variant.option_values) || variant.option_values.length === 0,
    ) ??
    sourceVariants[0];
  const variantIdMap = new Map<number, number>();
  const sourceBaseId = readPositiveInteger(sourceBase?.id);
  const targetVariantsBySku = new Map<string, JsonRecord>();
  for (const variant of targetVariants) {
    const sku = normalizeText(variant.sku);
    if (sku) targetVariantsBySku.set(sku, variant);
  }

  if (sourceBase && targetBaseId) {
    const baseOptionValues = mapOptionValues(sourceBase);
    await apiRequest(
      environment,
      `/catalog/products/${productId}/variants/${targetBaseId}`,
      {
        method: "PUT",
        body: {
          ...pick(sourceBase, VARIANT_FIELDS),
          ...(baseOptionValues.length > 0
            ? { option_values: baseOptionValues }
            : {}),
        },
        resource: `base variant for product ${productId}`,
      },
    );
    if (sourceBaseId) variantIdMap.set(sourceBaseId, targetBaseId);
  }

  for (const sourceVariant of sourceVariants) {
    const sourceVariantId = readPositiveInteger(sourceVariant.id);
    const optionValues = Array.isArray(sourceVariant.option_values)
      ? sourceVariant.option_values
      : [];
    if (
      !sourceVariantId ||
      sourceVariantId === sourceBaseId ||
      optionValues.length === 0
    ) continue;

    const mappedValues = mapOptionValues(sourceVariant);

    const variantBody = {
      ...pick(sourceVariant, VARIANT_FIELDS),
      option_values: mappedValues,
    };
    const existingVariant = targetVariantsBySku.get(normalizeText(sourceVariant.sku));
    const existingVariantId = readPositiveInteger(existingVariant?.id);
    const payload = existingVariantId
      ? await apiRequest(
          environment,
          `/catalog/products/${productId}/variants/${existingVariantId}`,
          {
            method: "PUT",
            body: variantBody,
            resource: `variant ${readString(sourceVariant.sku) || existingVariantId}`,
          },
        )
      : await apiRequest(
          environment,
          `/catalog/products/${productId}/variants`,
          {
            method: "POST",
            body: variantBody,
            resource: `variants for product ${productId}`,
          },
        );
    const targetVariantId = existingVariantId ?? readPositiveInteger(asRecord(asRecord(payload)?.data)?.id);
    if (targetVariantId) variantIdMap.set(sourceVariantId, targetVariantId);
  }

  for (const sourceMetafields of sourceRecord.variantMetafields) {
    const targetVariantId = variantIdMap.get(sourceMetafields.variantId);
    if (targetVariantId) {
      await syncMetafields(
        environment,
        `/catalog/products/${productId}/variants/${targetVariantId}/metafields`,
        sourceMetafields.data,
        `metafields for variant ${targetVariantId}`,
      );
    }
  }
  return variantIdMap;
}

function mapExistingVariants(sourceRecord: SnapshotProduct, target: JsonRecord) {
  const result = new Map<number, number>();
  const sourceVariants = Array.isArray(sourceRecord.data.variants)
    ? sourceRecord.data.variants.flatMap((value) => asRecord(value) ? [asRecord(value)!] : [])
    : [];
  const targetVariants = Array.isArray(target.variants)
    ? target.variants.flatMap((value) => asRecord(value) ? [asRecord(value)!] : [])
    : [];
  const targetBySku = new Map(
    targetVariants.flatMap((variant) => {
      const sku = normalizeText(variant.sku);
      return sku ? [[sku, variant] as const] : [];
    }),
  );
  for (const source of sourceVariants) {
    const sourceId = readPositiveInteger(source.id);
    const targetVariant = targetBySku.get(normalizeText(source.sku));
    const targetId = readPositiveInteger(targetVariant?.id);
    if (sourceId && targetId) result.set(sourceId, targetId);
  }
  const sourceBaseId = readPositiveInteger(sourceRecord.data.base_variant_id);
  const targetBaseId = readPositiveInteger(target.base_variant_id);
  if (sourceBaseId && targetBaseId && !result.has(sourceBaseId)) {
    result.set(sourceBaseId, targetBaseId);
  }
  return result;
}

async function reconcileProducts(
  environment: ConnectedEnvironment,
  channelId: number,
  manifest: CatalogSnapshotManifestV1,
  categoryMap: Map<number, number>,
  onProgress?: (currentStep: string, stepIndex?: number, totalSteps?: number) => Promise<void>,
) {
  const targetProducts = (
    await fetchCollection(
      environment,
      "/catalog/products?include=variants",
      "destination products",
    )
  ).flatMap((value) => {
    const record = asRecord(value);
    return record ? [record] : [];
  });
  let taxClasses: JsonRecord[] | null = null;
  const sourceTaxClasses = manifest.catalog.taxClasses.flatMap((value) => {
    const record = asRecord(value);
    return record ? [record] : [];
  });
  const sourceBrands = new Map(
    manifest.catalog.brands.flatMap((value) => {
      const id = readPositiveInteger(value.id);
      return id ? [[id, readString(value.name)] as const] : [];
    }),
  );
  const availableTargets = new Set(targetProducts);
  const sourceToTargetProduct = new Map<number, number>();
  const sourceToTargetVariant = new Map<number, number>();
  const newlyCreatedSourceIds = new Set<number>();
  const restoredProductIds: number[] = [];
  let created = 0;
  let updated = 0;
  const warnings: string[] = [];
  let progressIndex = 1;
  const totalProgressSteps = Math.max(manifest.catalog.products.length * 2 + 2, 2);

  for (const sourceRecord of manifest.catalog.products) {
    const source = sourceRecord.data;
    const sourceId = readPositiveInteger(source.id);
    const name = readString(source.name);
    if (!sourceId || !name) {
      throw new CatalogRestoreError("The snapshot contains an invalid product.");
    }
    try {
    const sourceKey = productMatchKey(source);
    const matches = [...availableTargets].filter((target) => {
      const targetKey = productMatchKey(target);
      return Boolean(
        ([...sourceKey.skus].some((sku) => targetKey.skus.has(sku))) ||
        (sourceKey.slug && targetKey.slug === sourceKey.slug),
      );
    });

    if (matches.length > 1) {
      throw new CatalogRestoreError(
        `Product ${name} matches more than one destination product by SKU or slug. Resolve the duplicate before restoring.`,
      );
    }

    const categories = sourceProductCategoryIds(source, categoryMap);

    let target: JsonRecord;
    let productId: number;

    if (matches[0]) {
      await onProgress?.(
        `Using existing product “${name}” — preserving attributes, variants, images, and metadata`,
        progressIndex++,
        totalProgressSteps,
      );
      target = matches[0];
      productId = readPositiveInteger(target.id)!;
      availableTargets.delete(target);
      // The product record itself is preserved, but its destination channel
      // and category assignments are updated by this restore.
      updated += 1;
    } else {
      await onProgress?.(
        `Creating product “${name}”`,
        progressIndex++,
        totalProgressSteps,
      );
      taxClasses ??= await resolveTaxClassMap(environment);
      const base: JsonRecord = { ...pick(source, PRODUCT_FIELDS) };
      const brandName = readString(source.brand_name) || sourceBrands.get(Number(source.brand_id));
      if (brandName) base.brand_name = brandName;
      const sourceTaxClass = sourceTaxClasses.find(
        (value) => Number(value.id) === Number(source.tax_class_id),
      );
      const sourceTaxName = readString(sourceTaxClass?.name);
      const targetTaxClass = taxClasses.find(
        (value) => normalizeText(value.name) === normalizeText(sourceTaxName),
      );
      if (targetTaxClass) base.tax_class_id = Number(targetTaxClass.id);
      const payload = await apiRequest(environment, "/catalog/products", {
        method: "POST",
        body: { ...base, categories },
        resource: `product ${name}`,
      });
      target = asRecord(asRecord(payload)?.data) ?? {};
      productId = readPositiveInteger(target.id) ?? 0;
      if (!productId) {
        throw new CatalogRestoreError(`BigCommerce did not return the ID for product ${name}.`);
      }
      created += 1;
      newlyCreatedSourceIds.add(sourceId);
    }

    sourceToTargetProduct.set(sourceId, productId);
    restoredProductIds.push(productId);

    for (const batch of chunk(categories, 50)) {
      await apiRequest(environment, "/catalog/products/category-assignments", {
        method: "PUT",
        body: batch.map((categoryId) => ({
          product_id: productId,
          category_id: categoryId,
        })),
        resource: `category assignments for product ${name}`,
      });
    }

    // Existing products are deliberately preserved. Restore only associates
    // them with this channel and the snapshot categories; their attributes,
    // variants, images, modifiers, and metadata remain unchanged.
    if (!newlyCreatedSourceIds.has(sourceId)) {
      for (const [sourceVariantId, targetVariantId] of mapExistingVariants(sourceRecord, target)) {
        sourceToTargetVariant.set(sourceVariantId, targetVariantId);
      }
      await onProgress?.(
        `Assigned “${name}” to ${categories.length} snapshot categories; channel assignment queued`,
        progressIndex++,
        totalProgressSteps,
      );
      continue;
    }

    const variantCount = Array.isArray(source.variants) ? source.variants.length : 0;
    const imageCount = Array.isArray(source.images) ? source.images.length : 0;
    await onProgress?.(
      `Restoring “${name}” — ${variantCount} variants, ${imageCount} images, and product metadata`,
      progressIndex++,
      totalProgressSteps,
    );

    target = await loadProduct(environment, productId);
    await syncImages(
      environment,
      productId,
      Array.isArray(target.images) ? target.images : [],
      Array.isArray(source.images) ? source.images : [],
    );
    await replaceProductChildren(environment, productId, target, source);
    const variantMap = await rebuildVariants(environment, productId, target, sourceRecord);
    for (const [sourceVariantId, targetVariantId] of variantMap) {
      sourceToTargetVariant.set(sourceVariantId, targetVariantId);
    }

    await syncMetafields(
      environment,
      `/catalog/products/${productId}/metafields`,
      sourceRecord.metafields,
      `metafields for product ${name}`,
    );
    } catch (error) {
      const warning = `${name}: ${error instanceof Error ? error.message : "Product restore failed."}`;
      warnings.push(warning);
      await onProgress?.(
        `Skipped remaining work for “${name}” after an error; continuing with the next product`,
        progressIndex++,
        totalProgressSteps,
      );
    }
  }

  for (const sourceRecord of manifest.catalog.products) {
    const sourceId = readPositiveInteger(sourceRecord.data.id);
    if (!sourceId || !newlyCreatedSourceIds.has(sourceId)) continue;
    const targetId = sourceId ? sourceToTargetProduct.get(sourceId) : undefined;
    if (!targetId) continue;

    const sourceRelatedProducts = Array.isArray(sourceRecord.data.related_products)
      ? sourceRecord.data.related_products
      : [];
    const automaticRelatedProducts =
      sourceRelatedProducts.length === 0 ||
      sourceRelatedProducts.some((value) => Number(value) === -1);
    const mappedRelatedProducts = sourceRelatedProducts.flatMap((value) => {
      const relatedSourceId = readPositiveInteger(value);
      const relatedTargetId = relatedSourceId
        ? sourceToTargetProduct.get(relatedSourceId)
        : undefined;
      return relatedTargetId ? [relatedTargetId] : [];
    });
    const relatedProducts = automaticRelatedProducts || mappedRelatedProducts.length === 0
      ? [-1]
      : mappedRelatedProducts;

    try {
      await apiRequest(environment, `/catalog/products/${targetId}`, {
        method: "PUT",
        body: { related_products: relatedProducts },
        resource: `related products for product ${targetId}`,
      });
    } catch (error) {
      warnings.push(`Related products for product ${targetId}: ${error instanceof Error ? error.message : "Update failed."}`);
    }
  }

  for (const batch of chunk(restoredProductIds, 50)) {
    await onProgress?.(
      `Assigning ${batch.length} restored products to the destination channel`,
      totalProgressSteps - 1,
      totalProgressSteps,
    );
    try {
      await apiRequest(environment, "/catalog/products/channel-assignments", {
        method: "PUT",
        body: batch.map((productId) => ({ product_id: productId, channel_id: channelId })),
        resource: "product channel assignments",
      });
    } catch (error) {
      warnings.push(`Channel assignment batch: ${error instanceof Error ? error.message : "Assignment failed."}`);
    }
  }

  await onProgress?.(
    `Product restore complete: ${created} created and ${updated} existing products assigned`,
    totalProgressSteps,
    totalProgressSteps,
  );

  return {
    created,
    updated,
    assignmentsRemoved: 0,
    warnings,
    sourceToTargetProduct,
    sourceToTargetVariant,
  };
}

export async function restoreCatalogSnapshot(input: {
  snapshotId: number;
  destinationEnvironmentId: number;
  destinationChannelId: number;
  userId?: string;
  restoreGroups?: SnapshotRestoreGroup[];
  onProgress?: (currentStep: string, stepIndex?: number, totalSteps?: number) => Promise<void>;
}): Promise<CatalogRestoreResult> {
  const userId = input.userId ?? (await requireAppUser()).id;
  const snapshot = await getAccessibleCatalogSnapshot(userId, input.snapshotId);

  if (!snapshot) {
    throw new CatalogRestoreError("The selected snapshot was not found.");
  }

  const manifest = parseManifest(snapshot);
  const { environment, channelName } = await resolveDestination(
    userId,
    input.destinationEnvironmentId,
    input.destinationChannelId,
  );
  const requestedRestoreGroups = parseSnapshotRestoreGroups(
    input.restoreGroups?.length ? input.restoreGroups : ["catalog"],
  );
  const availableRestoreGroups = new Set<SnapshotRestoreGroup>([
    "catalog",
    ...Object.keys(manifest.configuration ?? {}).flatMap((group) =>
      parseSnapshotRestoreGroups([group]),
    ),
  ]);
  const restoreGroups = requestedRestoreGroups.filter((group) =>
    availableRestoreGroups.has(group),
  );
  if (restoreGroups.length === 0) {
    throw new CatalogRestoreError("Choose at least one snapshot section to restore.");
  }
  let categoryState: CategoryRestoreState = {
    sourceToTarget: new Map(),
    created: 0,
    updated: 0,
  };
  let productState = {
    created: 0,
    updated: 0,
    assignmentsRemoved: 0,
    warnings: [] as string[],
    sourceToTargetProduct: new Map<number, number>(),
    sourceToTargetVariant: new Map<number, number>(),
  };
  if (restoreGroups.includes("catalog")) {
    await input.onProgress?.("Creating and updating categories", 1, 3);
    categoryState = await reconcileCategories(
      environment,
      input.destinationChannelId,
      channelName,
      manifest.catalog.categories,
    );
    await input.onProgress?.("Creating and updating products, variants, images, and metadata", 2, 3);
    productState = await reconcileProducts(
      environment,
      input.destinationChannelId,
      manifest,
      categoryState.sourceToTarget,
      input.onProgress,
    );
    await input.onProgress?.("Verifying channel catalog assignments", 3, 3);
  }
  if (
    restoreGroups.includes("localization") ||
    (!restoreGroups.includes("catalog") && restoreGroups.some((group) =>
      group === "pricing" || group === "b2b"
    ))
  ) {
    await input.onProgress?.(
      "Mapping destination products and categories for translations",
    );
    try {
      await mapExistingCatalogForTranslations(
        environment,
        input.destinationChannelId,
        manifest,
        categoryState.sourceToTarget,
        productState.sourceToTargetProduct,
        productState.sourceToTargetVariant,
      );
    } catch (error) {
      productState.warnings.push(
        `Translation catalog mapping: ${error instanceof Error ? error.message : "The destination catalog could not be mapped."}`,
      );
    }
  }
  await restoreConfiguration(
    environment,
    input.destinationChannelId,
    manifest,
    restoreGroups,
    productState.warnings,
    productState.sourceToTargetProduct,
    productState.sourceToTargetVariant,
    categoryState.sourceToTarget,
    input.onProgress,
  );
  const manualActions: CatalogRestoreManualAction[] = [];
  if (restoreGroups.includes("pricing")) {
    const currencyAssignments = writableObject(capturedData(
      manifest.configuration?.pricing?.resources.currencyAssignments,
    ));
    const currencyCodes = currencyAssignments
      ? [...new Set([
          ...(Array.isArray(currencyAssignments.enabled_currencies)
            ? currencyAssignments.enabled_currencies
            : []),
          currencyAssignments.default_currency,
        ].flatMap((value) => {
          const code = readString(value).trim().toUpperCase();
          return code ? [code] : [];
        }))]
      : [];
    if (currencyCodes.length > 0) {
      const currencyLabel = currencyCodes.join(", ");
      const description = `Assign the intended ${currencyLabel} payment configuration (for example, Test Payment Provider) to ${channelName} under Payments → Manage Channel Visibility.`;
      productState.warnings.push(`Manual action required: ${description}`);
      manualActions.push({
        label: "Open Payments → Manage Channel Visibility",
        description,
        href: `https://store-${environment.storeHash}.mybigcommerce.com/manage/settings/payment`,
      });
    }
  }
  return {
    snapshotName: snapshot.name,
    snapshotVersion: snapshot.snapshotVersion,
    categoriesCreated: categoryState.created,
    categoriesUpdated: categoryState.updated,
    categoriesRemoved: 0,
    productsCreated: productState.created,
    productsUpdated: productState.updated,
    productAssignmentsRemoved: productState.assignmentsRemoved,
    warnings: productState.warnings,
    manualActions,
    restoredGroups: restoreGroups,
    destinationEnvironmentName: environment.name,
    destinationChannelName: channelName,
  };
}

export async function clearCatalogChannel(input: {
  destinationEnvironmentId: number;
  destinationChannelId: number;
  userId?: string;
  onProgress?: (currentStep: string, stepIndex?: number, totalSteps?: number) => Promise<void>;
}): Promise<ClearCatalogResult> {
  const userId = input.userId ?? (await requireAppUser()).id;
  const { environment, channelName } = await resolveDestination(
    userId,
    input.destinationEnvironmentId,
    input.destinationChannelId,
  );

  const assignments = await fetchCollection(
    environment,
    `/catalog/products/channel-assignments?channel_id:in=${input.destinationChannelId}`,
    "product channel assignments",
  );
  const productIds = assignments.flatMap((value) => {
    const id = readPositiveInteger(asRecord(value)?.product_id);
    return id ? [id] : [];
  });

  const uniqueProductIds = [...new Set(productIds)];
  const productBatches = chunk(uniqueProductIds, 50);
  const totalSteps = productBatches.length + 2;
  await input.onProgress?.(
    uniqueProductIds.length
      ? `Found ${uniqueProductIds.length} product assignments`
      : "No product assignments found",
    0,
    totalSteps,
  );
  for (const [batchIndex, batch] of productBatches.entries()) {
    await input.onProgress?.(
      `Unassigning products ${batchIndex * 50 + 1}–${Math.min((batchIndex + 1) * 50, uniqueProductIds.length)} of ${uniqueProductIds.length}`,
      batchIndex + 1,
      totalSteps,
    );
    await apiRequest(
      environment,
      `/catalog/products/channel-assignments?channel_id:in=${input.destinationChannelId}&product_id:in=${batch.join(",")}`,
      { method: "DELETE", resource: "channel product assignments" },
    );
  }

  await wait(750);
  const remainingAssignments = await fetchCollection(
    environment,
    `/catalog/products/channel-assignments?channel_id:in=${input.destinationChannelId}`,
    "remaining product channel assignments",
  );
  if (remainingAssignments.some((value) => readPositiveInteger(asRecord(value)?.product_id))) {
    throw new CatalogRestoreError(
      "BigCommerce did not remove all product assignments from the channel. Check the token's Products modify scope and try again.",
    );
  }

  const trees = await fetchCollection(
    environment,
    `/catalog/trees?channel_id:in=${input.destinationChannelId}`,
    "category trees",
  );
  const categoryIds: number[] = [];
  for (const tree of trees) {
    const treeId = readPositiveInteger(asRecord(tree)?.id);
    if (!treeId) continue;
    const categories = await fetchCollection(
      environment,
      `/catalog/trees/categories?tree_id:in=${treeId}`,
      "channel categories",
    );
    categoryIds.push(
      ...categories.flatMap((value) => {
        const id = readPositiveInteger(asRecord(value)?.category_id);
        return id ? [id] : [];
      }),
    );
  }

  const uniqueCategoryIds = [...new Set(categoryIds)];
  const categoryBatches = chunk(uniqueCategoryIds, 50);
  const finalTotalSteps = productBatches.length + categoryBatches.length + 2;
  for (const [batchIndex, batch] of categoryBatches.entries()) {
    await input.onProgress?.(
      `Removing categories ${batchIndex * 50 + 1}–${Math.min((batchIndex + 1) * 50, uniqueCategoryIds.length)} of ${uniqueCategoryIds.length}`,
      productBatches.length + batchIndex + 1,
      finalTotalSteps,
    );
    const deleteResult = await apiRequest(
      environment,
      `/catalog/trees/categories?category_id:in=${batch.join(",")}`,
      { method: "DELETE", body: {}, resource: "channel categories" },
    );
    const deleteMeta = asRecord(asRecord(deleteResult)?.meta);
    if (Number(deleteMeta?.failed ?? 0) > 0) {
      throw new CatalogRestoreError(
        `BigCommerce failed to remove ${Number(deleteMeta?.failed)} channel categories.`,
      );
    }
  }

  await wait(750);
  const remainingTrees = await fetchCollection(
    environment,
    `/catalog/trees?channel_id:in=${input.destinationChannelId}`,
    "remaining category trees",
  );
  for (const tree of remainingTrees) {
    const treeId = readPositiveInteger(asRecord(tree)?.id);
    if (!treeId) continue;
    const remainingCategories = await fetchCollection(
      environment,
      `/catalog/trees/categories?tree_id:in=${treeId}`,
      "remaining channel categories",
    );
    if (remainingCategories.length > 0) {
      throw new CatalogRestoreError(
        "BigCommerce did not remove all channel categories. Check the token's Products modify scope and try again.",
      );
    }
  }

  await input.onProgress?.(
    `Verified: ${uniqueProductIds.length} products unassigned and ${uniqueCategoryIds.length} categories removed`,
    finalTotalSteps,
    finalTotalSteps,
  );

  return {
    categoriesRemoved: uniqueCategoryIds.length,
    productsUnassigned: uniqueProductIds.length,
    destinationEnvironmentName: environment.name,
    destinationChannelName: channelName,
  };
}
