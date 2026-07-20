import "server-only";

import { requireAppUser } from "@/lib/auth";
import type { CatalogCategory, CatalogProduct } from "@/lib/catalog-types";
import {
  applyCatalogTranslations,
  getSnapshotLocaleTranslations,
  parseCatalogLocales,
  selectCatalogLocale,
  type CatalogLocale,
} from "@/lib/catalog-localization";
import {
  hasCapturedTranslations,
  SNAPSHOT_RESTORE_GROUPS,
  type CapturedConfigurationGroup,
  type CapturedConfigurationResource,
  type CapturedSnapshotConfiguration,
  type SnapshotRestoreGroup,
} from "@/lib/snapshot-configuration";
import {
  addCatalogSnapshot,
  completeCatalogSnapshotCapture,
  getBigCommerceEnvironmentConnection,
  getAccessibleCatalogSnapshot,
  getCatalogOperation,
  getCatalogSnapshotCaptureProducts,
  getCatalogSnapshotCaptureState,
  getCatalogSnapshotVersionsByName,
  getLatestCatalogSnapshotByName,
  completeCatalogSnapshotCaptureInitialization,
  initializeCatalogSnapshotCategoryState,
  removeCatalogSnapshotCaptureState,
  saveCatalogSnapshotCategoryBatch,
  saveCatalogSnapshotProductBatch,
  updateCatalogOperation,
  type BigCommerceEnvironmentConnection,
  type CatalogSnapshotSummary,
} from "@/lib/db";

const API_BASE_URL = "https://api.bigcommerce.com/stores";
const B2B_API_BASE_URL = "https://api-b2b.bigcommerce.com/api/v3/io";
const REQUEST_TIMEOUT_MS = 12_000;
const PAGE_SIZE = 250;
const CAPTURE_CONCURRENCY = 5;
const WORKFLOW_CATEGORY_BATCH_SIZE = 10;
const WORKFLOW_PRODUCT_BATCH_SIZE = 30;
const FORMAT_VERSION = 1 as const;
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
const CDN_HOST_PATTERN = /^cdn\d+\.bigcommerce\.com$/i;
const RATE_LIMIT_RETRIES = 6;
const RATE_LIMIT_FLOOR = 3;

const requestQueues = new Map<string, Promise<void>>();

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function queueStoreRequest<T>(storeHash: string, request: () => Promise<T>) {
  const key = storeHash.toLowerCase();
  const previous = requestQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  requestQueues.set(key, queued);
  await previous;

  try {
    return await request();
  } finally {
    release();
    if (requestQueues.get(key) === queued) requestQueues.delete(key);
  }
}

type JsonRecord = Record<string, unknown>;
type ConnectedEnvironment = BigCommerceEnvironmentConnection & {
  accessToken: string;
};
type SnapshotProgress = (
  currentStep: string,
  stepIndex?: number,
  totalSteps?: number,
) => Promise<void>;

type SnapshotCategoryRecord = {
  data: JsonRecord;
  metafields: unknown[];
};

type SnapshotCategorySeed = {
  tree: JsonRecord | null;
  categoryTree: unknown[];
  categoryRecords: JsonRecord[];
};

type SnapshotCategoryData = {
  tree: JsonRecord | null;
  categoryTree: unknown[];
  categories: SnapshotCategoryRecord[];
};

type SnapshotVariantMetafields = {
  variantId: number;
  data: unknown[];
};

type SnapshotProductRecord = {
  data: JsonRecord;
  metafields: unknown[];
  variantMetafields: SnapshotVariantMetafields[];
};

export type CatalogSnapshotManifestV1 = {
  formatVersion: typeof FORMAT_VERSION;
  capturedAt: string;
  source: {
    environmentId: number;
    environmentName: string;
    storeHash: string;
    channelId: number;
    channelName: string;
  };
  store: {
    currency: string;
    currencySymbol: string;
    currencySymbolLocation: string;
    decimalPlaces: number;
  };
  catalog: {
    channel: JsonRecord;
    tree: JsonRecord | null;
    categoryTree: unknown[];
    categories: SnapshotCategoryRecord[];
    brands: JsonRecord[];
    taxClasses: unknown[];
    products: SnapshotProductRecord[];
  };
  configuration?: CapturedSnapshotConfiguration;
  preview: {
    currency: string;
    categories: CatalogCategory[];
    products: CatalogProduct[];
  };
};

export type CatalogSnapshotView = {
  summary: CatalogSnapshotSummary;
  versions: CatalogSnapshotSummary[];
  isOwner: boolean;
  categories: CatalogCategory[];
  products: CatalogProduct[];
  currency: string;
  locales: CatalogLocale[];
  activeLocale: string | null;
  availableRestoreGroups: SnapshotRestoreGroup[];
  hasTranslations: boolean;
  error: string | null;
};

export class SnapshotCaptureError extends Error {}

export class SnapshotVersionConfirmationRequired extends Error {
  constructor(readonly existing: CatalogSnapshotSummary) {
    super("Confirm that you want to create a new version of this snapshot.");
    this.name = "SnapshotVersionConfirmationRequired";
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function pickFields(record: JsonRecord, keys: readonly string[]) {
  return Object.fromEntries(
    keys.flatMap((key) =>
      record[key] === undefined || record[key] === null
        ? []
        : [[key, record[key]]],
    ),
  );
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readPositiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function readNonNegativeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function getApiErrorMessage(status: number, resource: string) {
  if (status === 401) {
    return "Check the saved access token.";
  }

  if (status === 403) {
    return `The token cannot read ${resource}. Check its Products and Channel Settings scopes.`;
  }

  if (status === 429) {
    return "BigCommerce rate limit persisted after automatic throttling. Try the snapshot again shortly.";
  }

  return `BigCommerce did not return ${resource}.`;
}

function getRequestErrorMessage(error: unknown) {
  return error instanceof SnapshotCaptureError
    ? error.message
    : error instanceof Error && error.name === "TimeoutError"
      ? "BigCommerce took too long to respond while capturing the snapshot."
      : "Unable to reach BigCommerce while capturing the snapshot.";
}

async function fetchBigCommerce(
  environment: ConnectedEnvironment,
  path: string,
) {
  return queueStoreRequest(environment.storeHash, async () => {
    let response!: Response;

    for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
      response = await fetch(
        `${API_BASE_URL}/${encodeURIComponent(environment.storeHash)}${path}`,
        {
          headers: {
            Accept: "application/json",
            "X-Auth-Token": environment.accessToken,
          },
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );

      const requestsLeft = Number(
        response.headers.get("x-rate-limit-requests-left"),
      );
      const resetMilliseconds = Number(
        response.headers.get("x-rate-limit-time-reset-ms"),
      );

      if (response.status !== 429) {
        if (
          Number.isFinite(requestsLeft) &&
          requestsLeft <= RATE_LIMIT_FLOOR &&
          Number.isFinite(resetMilliseconds) &&
          resetMilliseconds > 0
        ) {
          await wait(Math.min(resetMilliseconds + 250, 30_000));
        }
        return response;
      }

      if (attempt === RATE_LIMIT_RETRIES) return response;

      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : Number.isFinite(resetMilliseconds) && resetMilliseconds > 0
          ? Math.min(resetMilliseconds + 250, 30_000)
          : Math.min(1000 * 2 ** attempt, 20_000);
      await wait(delay);
    }

    return response;
  });
}

async function fetchJson(
  environment: ConnectedEnvironment,
  path: string,
  resource: string,
) {
  const response = await fetchBigCommerce(environment, path);

  if (!response.ok) {
    throw new SnapshotCaptureError(
      getApiErrorMessage(response.status, resource),
    );
  }

  const text = response.status === 204 ? "" : await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SnapshotCaptureError(
      `BigCommerce returned invalid JSON while capturing ${resource}.`,
    );
  }
}

function readDataArray(payload: unknown, resource: string) {
  const record = asRecord(payload);
  const data = record?.data;

  if (!Array.isArray(data)) {
    throw new SnapshotCaptureError(
      `BigCommerce returned an unexpected ${resource} response.`,
    );
  }

  return data;
}

function readTotalPages(payload: unknown) {
  const record = asRecord(payload);
  const meta = asRecord(record?.meta);
  const pagination = asRecord(meta?.pagination);
  const totalPages = Number(pagination?.total_pages);

  return Number.isSafeInteger(totalPages) && totalPages > 0 ? totalPages : 1;
}

async function fetchV3Collection(
  environment: ConnectedEnvironment,
  path: string,
  resource: string,
) {
  const items: unknown[] = [];
  let page = 1;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const payload = await fetchJson(
      environment,
      `${path}${separator}limit=${PAGE_SIZE}&page=${page}`,
      resource,
    );
    items.push(...readDataArray(payload, resource));

    if (page >= readTotalPages(payload)) {
      break;
    }

    page += 1;
  }

  return items;
}

function readB2BDataArray(payload: unknown, resource: string) {
  const data = asRecord(payload)?.data;
  if (Array.isArray(data)) return data;
  if (asRecord(data)) return Object.values(asRecord(data)!);
  throw new SnapshotCaptureError(
    `BigCommerce B2B Edition returned an unexpected ${resource} response.`,
  );
}

async function fetchB2BJson(
  environment: ConnectedEnvironment,
  path: string,
  resource: string,
) {
  return queueStoreRequest(environment.storeHash, async () => {
    let response!: Response;
    for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
      response = await fetch(`${B2B_API_BASE_URL}${path}`, {
        headers: {
          Accept: "application/json",
          "X-Auth-Token": environment.accessToken,
          "X-Store-Hash": environment.storeHash,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status !== 429 || attempt === RATE_LIMIT_RETRIES) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30_000)
          : Math.min(1000 * 2 ** attempt, 20_000),
      );
    }
    if (!response.ok) {
      const message = response.status === 403
        ? `The token cannot read ${resource}. Enable the B2B Edition read-only scope.`
        : response.status === 404
          ? `B2B Edition did not expose ${resource} for this store.`
          : getApiErrorMessage(response.status, resource);
      throw new SnapshotCaptureError(message);
    }
    return (await response.json()) as unknown;
  });
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
    const payload = await fetchB2BJson(
      environment,
      `${path}${separator}limit=${PAGE_SIZE}&offset=${offset}`,
      resource,
    );
    const page = readB2BDataArray(payload, resource);
    items.push(...page);
    const pagination = asRecord(asRecord(asRecord(payload)?.meta)?.pagination);
    const totalCount = Number(pagination?.totalCount);
    if (
      page.length === 0 ||
      page.length < PAGE_SIZE ||
      (Number.isFinite(totalCount) && items.length >= totalCount)
    ) {
      return items;
    }
    offset += page.length;
  }
}

async function mapInBatches<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];

  for (let index = 0; index < items.length; index += CAPTURE_CONCURRENCY) {
    const batch = items.slice(index, index + CAPTURE_CONCURRENCY);
    results.push(...(await Promise.all(batch.map(mapper))));
  }

  return results;
}

async function fetchMetafields(
  environment: ConnectedEnvironment,
  path: string,
  resource: string,
) {
  return fetchV3Collection(environment, path, resource);
}

function toShortDescription(value: unknown) {
  const text = readString(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

  return text.length <= 150 ? text : `${text.slice(0, 147).trimEnd()}…`;
}

function readImageUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && CDN_HOST_PATTERN.test(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function parsePreviewCategory(
  value: unknown,
  depth = 0,
): CatalogCategory | null {
  const record = asRecord(value);

  if (!record || depth > 20) {
    return null;
  }

  const id = readPositiveInteger(record.id);
  const name = readString(record.name);

  if (!id || !name) {
    return null;
  }

  const rawChildren = Array.isArray(record.children) ? record.children : [];
  const children = rawChildren.flatMap((child) => {
    const category = parsePreviewCategory(child, depth + 1);
    return category ? [category] : [];
  });

  return { id, name, children };
}

function toPreviewProduct(product: JsonRecord): CatalogProduct | null {
  const id = readPositiveInteger(product.id);
  const name = readString(product.name);

  if (!id || !name) {
    return null;
  }

  const primaryImage = asRecord(product.primary_image);
  const calculatedPrice = readNonNegativeNumber(product.calculated_price);
  const basePrice = readNonNegativeNumber(product.price);
  const categoryIds = Array.isArray(product.categories)
    ? product.categories.flatMap((value) => {
        const categoryId = readPositiveInteger(value);
        return categoryId ? [categoryId] : [];
      })
    : [];

  return {
    id,
    name,
    description: toShortDescription(product.description),
    price: calculatedPrice ?? basePrice,
    imageUrl: readImageUrl(primaryImage?.url_standard),
    categoryIds,
  };
}

async function loadChannel(
  environment: ConnectedEnvironment,
  channelId: number,
) {
  const payload = await fetchJson(
    environment,
    `/v3/channels/${channelId}`,
    "the source channel",
  );
  const channel = asRecord(asRecord(payload)?.data);

  if (
    !channel ||
    readPositiveInteger(channel.id) !== channelId ||
    !readString(channel.name) ||
    readString(channel.status).toLowerCase() === "deleted"
  ) {
    throw new SnapshotCaptureError(
      "The selected channel is missing, deleted, or invalid.",
    );
  }

  return channel;
}

async function loadCategorySeed(
  environment: ConnectedEnvironment,
  channelId: number,
  onProgress?: SnapshotProgress,
): Promise<SnapshotCategorySeed> {
  await onProgress?.("Finding the category tree assigned to this channel", 8, 100);
  const trees = await fetchV3Collection(
    environment,
    "/v3/catalog/trees",
    "category trees",
  );
  const tree = trees
    .map(asRecord)
    .find(
      (candidate) =>
        candidate &&
        Array.isArray(candidate.channels) &&
        candidate.channels.some((id) => Number(id) === channelId),
    );
  const treeId = readPositiveInteger(tree?.id);

  if (!tree || !treeId) {
    await onProgress?.("No category tree is assigned to this channel", 25, 100);
    return {
      tree: null,
      categoryTree: [] as unknown[],
      categoryRecords: [] as JsonRecord[],
    };
  }

  await onProgress?.(`Loading category tree ${readString(tree.name) || `#${treeId}`}`, 12, 100);
  const [nestedPayload, detailedCategories] = await Promise.all([
    fetchJson(
      environment,
      `/v3/catalog/trees/${treeId}/categories`,
      "the nested category tree",
    ),
    fetchV3Collection(
      environment,
      `/v3/catalog/trees/categories?tree_id:in=${treeId}`,
      "category attributes",
    ),
  ]);
  const categoryTree = readDataArray(nestedPayload, "nested category tree");
  const categoryRecords = detailedCategories.flatMap((value) => {
    const category = asRecord(value);
    return category ? [category] : [];
  });
  return { tree, categoryTree, categoryRecords };
}

async function captureCategoryRecords(
  environment: ConnectedEnvironment,
  categoryRecords: JsonRecord[],
  onProgress?: SnapshotProgress,
  startIndex = 0,
  totalCategories = categoryRecords.length,
) {
  const categories: SnapshotCategoryRecord[] = [];
  for (let offset = 0; offset < categoryRecords.length; offset += 1) {
    const category = categoryRecords[offset];
    const index = startIndex + offset;
    const categoryId = readPositiveInteger(category.category_id);

    if (!categoryId) {
      throw new SnapshotCaptureError(
        "BigCommerce returned a category without a valid ID.",
      );
    }

    const categoryName = readString(category.name) || `category #${categoryId}`;
    await onProgress?.(
      `Capturing category ${index + 1} of ${totalCategories}: ${categoryName}`,
      15 + Math.round(((index + 1) / Math.max(totalCategories, 1)) * 12),
      100,
    );
    categories.push({
      data: category,
      metafields: await fetchMetafields(
        environment,
        `/v3/catalog/categories/${categoryId}/metafields`,
        `metafields for category ${categoryId}`,
      ),
    });
  }

  return categories;
}

async function loadCategoryData(
  environment: ConnectedEnvironment,
  channelId: number,
  onProgress?: SnapshotProgress,
): Promise<SnapshotCategoryData> {
  const seed = await loadCategorySeed(environment, channelId, onProgress);
  const categories = await captureCategoryRecords(
    environment,
    seed.categoryRecords,
    onProgress,
  );

  return {
    tree: seed.tree,
    categoryTree: seed.categoryTree,
    categories,
  };
}

async function enrichProduct(
  environment: ConnectedEnvironment,
  product: JsonRecord,
): Promise<SnapshotProductRecord> {
  const productId = readPositiveInteger(product.id);

  if (!productId) {
    throw new SnapshotCaptureError(
      "BigCommerce returned a product without a valid ID.",
    );
  }

  const variants = Array.isArray(product.variants)
    ? product.variants.flatMap((value) => {
        const variant = asRecord(value);
        return variant ? [variant] : [];
      })
    : [];
  const [metafields, variantMetafields] = await Promise.all([
    fetchMetafields(
      environment,
      `/v3/catalog/products/${productId}/metafields`,
      `metafields for product ${productId}`,
    ),
    mapInBatches(variants, async (variant) => {
      const variantId = readPositiveInteger(variant.id);

      if (!variantId) {
        throw new SnapshotCaptureError(
          `Product ${productId} contains a variant without a valid ID.`,
        );
      }

      return {
        variantId,
        data: await fetchMetafields(
          environment,
          `/v3/catalog/products/${productId}/variants/${variantId}/metafields`,
          `metafields for variant ${variantId}`,
        ),
      };
    }),
  ]);

  return { data: product, metafields, variantMetafields };
}

async function loadChannelProductIds(
  environment: ConnectedEnvironment,
  channelId: number,
) {
  const assignments = await fetchV3Collection(
    environment,
    `/v3/catalog/products/channel-assignments?channel_id:in=${channelId}`,
    "product channel assignments",
  );
  return [...new Set(assignments.flatMap((value) => {
    const id = readPositiveInteger(asRecord(value)?.product_id);
    return id ? [id] : [];
  }))];
}

async function loadProductData(
  environment: ConnectedEnvironment,
  channelId: number,
  onProgress?: SnapshotProgress,
) {
  await onProgress?.("Resolving products assigned to this channel", 30, 100);
  const productIds = await loadChannelProductIds(environment, channelId);
  if (productIds.length === 0) {
    await onProgress?.("No products are assigned to this channel", 85, 100);
    return [];
  }

  const products: JsonRecord[] = [];
  for (let index = 0; index < productIds.length; index += 50) {
    const batch = productIds.slice(index, index + 50);
    await onProgress?.(
      `Loading product records ${index + 1}–${Math.min(index + batch.length, productIds.length)} of ${productIds.length}`,
      32 + Math.round((index / productIds.length) * 5),
      100,
    );
    products.push(...(
      await fetchV3Collection(
      environment,
      `/v3/catalog/products?id:in=${batch.join(",")}&include=${PRODUCT_INCLUDES}`,
      "products",
      )
    ).flatMap((value) => {
      const product = asRecord(value);
      return product ? [product] : [];
    }));
  }

  const enrichedProducts: SnapshotProductRecord[] = [];
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const name = readString(product.name) || `product #${readPositiveInteger(product.id) ?? "unknown"}`;
    const variantCount = Array.isArray(product.variants) ? product.variants.length : 0;
    const imageCount = Array.isArray(product.images) ? product.images.length : 0;
    await onProgress?.(
      `Capturing product ${index + 1} of ${products.length}: ${name} · ${variantCount} variants · ${imageCount} images · metadata`,
      38 + Math.round(((index + 1) / Math.max(products.length, 1)) * 48),
      100,
    );
    enrichedProducts.push(await enrichProduct(environment, product));
  }

  return enrichedProducts;
}

async function loadSupportingData(environment: ConnectedEnvironment) {
  const [brands, taxClassesPayload, storePayload] = await Promise.all([
    fetchV3Collection(environment, "/v3/catalog/brands", "brands"),
    fetchJson(environment, "/v2/tax_classes", "tax classes"),
    fetchJson(environment, "/v2/store", "store currency metadata"),
  ]);
  const taxClasses = Array.isArray(taxClassesPayload) ? taxClassesPayload : [];
  const store = asRecord(storePayload);

  if (!store) {
    throw new SnapshotCaptureError(
      "BigCommerce returned unexpected store currency metadata.",
    );
  }

  return {
    brands: brands.flatMap((value) => {
      const brand = asRecord(value);
      return brand ? [brand] : [];
    }),
    taxClasses,
    store: {
      currency: readString(store.currency).toUpperCase() || "USD",
      currencySymbol: readString(store.currency_symbol),
      currencySymbolLocation: readString(store.currency_symbol_location),
      decimalPlaces: Number(store.decimal_places) || 2,
    },
  };
}

function capturedResource(
  label: string,
  scope: CapturedConfigurationResource["scope"],
  data: unknown,
  warning?: string,
): CapturedConfigurationResource {
  return { label, scope, data, ...(warning ? { warning } : {}) };
}

async function captureOptionalJson(
  environment: ConnectedEnvironment,
  path: string,
  label: string,
  scope: CapturedConfigurationResource["scope"],
) {
  try {
    return capturedResource(label, scope, await fetchJson(environment, path, label));
  } catch (error) {
    return capturedResource(
      label,
      scope,
      null,
      error instanceof Error ? error.message : `Unable to capture ${label}.`,
    );
  }
}

function mergeEffectiveChannelSettings(
  globalValue: unknown,
  channelValue: unknown,
): unknown {
  const globalRecord = asRecord(globalValue);
  const channelRecord = asRecord(channelValue);
  if (!channelRecord) return globalValue;

  return Object.fromEntries(Object.entries(channelRecord).map(([key, value]) => {
    const globalFallback = globalRecord?.[key];
    if (value === null || value === undefined) return [key, globalFallback ?? null];
    if (asRecord(value) && asRecord(globalFallback)) {
      return [key, mergeEffectiveChannelSettings(globalFallback, value)];
    }
    return [key, value];
  }));
}

async function captureEffectiveChannelSettings(
  environment: ConnectedEnvironment,
  globalPath: string,
  channelPath: string,
  label: string,
) {
  try {
    const [globalPayload, channelPayload] = await Promise.all([
      fetchJson(environment, globalPath, `global ${label}`),
      fetchJson(environment, channelPath, `channel ${label}`),
    ]);
    const globalData = asRecord(globalPayload)?.data ?? globalPayload;
    const channelData = asRecord(channelPayload)?.data ?? channelPayload;
    return capturedResource(
      label,
      "channel",
      mergeEffectiveChannelSettings(globalData, channelData),
    );
  } catch (error) {
    return capturedResource(
      label,
      "channel",
      null,
      error instanceof Error ? error.message : `Unable to capture ${label}.`,
    );
  }
}

async function captureOptionalCollection(
  environment: ConnectedEnvironment,
  path: string,
  label: string,
  scope: CapturedConfigurationResource["scope"],
) {
  try {
    return capturedResource(
      label,
      scope,
      await fetchV3Collection(environment, path, label),
    );
  } catch (error) {
    return capturedResource(
      label,
      scope,
      [],
      error instanceof Error ? error.message : `Unable to capture ${label}.`,
    );
  }
}

async function captureOptionalB2BCollection(
  environment: ConnectedEnvironment,
  path: string,
  label: string,
) {
  try {
    return capturedResource(
      label,
      "store",
      await fetchB2BCollection(environment, path, label),
    );
  } catch (error) {
    return capturedResource(
      label,
      "store",
      [],
      error instanceof Error ? error.message : `Unable to capture ${label}.`,
    );
  }
}

async function captureB2BDetails(
  environment: ConnectedEnvironment,
  values: unknown[],
  idKeys: string[],
  path: (id: number) => string,
  label: string,
) {
  const failures: string[] = [];
  const details = await mapInBatches(values, async (value) => {
    const record = asRecord(value);
    const id = idKeys.reduce<number | null>(
      (found, key) => found ?? readPositiveInteger(record?.[key]),
      null,
    );
    if (!id) return value;
    try {
      const payload = await fetchB2BJson(environment, path(id), `${label} ${id}`);
      return asRecord(payload)?.data ?? value;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `${label} ${id} failed.`);
      return value;
    }
  });
  return capturedResource(
    label,
    "store",
    details,
    failures.length > 0
      ? `${failures.length} ${label.toLowerCase()} could not be expanded; their list records were retained.`
      : undefined,
  );
}

async function captureB2BConfiguration(
  environment: ConnectedEnvironment,
): Promise<CapturedConfigurationGroup> {
  const [permissions, roleSummaries, companies, users, addresses, quotes, orders,
    invoices, payments, salesReps, companyExtraFields, userExtraFields,
    addressExtraFields, orderExtraFields, quoteExtraFields] = await Promise.all([
    captureOptionalB2BCollection(environment, "/companies/permissions", "B2B Company permissions"),
    captureOptionalB2BCollection(environment, "/companies/roles", "B2B Company roles"),
    captureOptionalB2BCollection(environment, "/companies?isIncludeExtraFields=1", "B2B Companies"),
    captureOptionalB2BCollection(environment, "/users?isIncludeExtraFields=1", "B2B Company users"),
    captureOptionalB2BCollection(environment, "/addresses", "B2B Company addresses"),
    captureOptionalB2BCollection(environment, "/rfq", "B2B quotes"),
    captureOptionalB2BCollection(environment, "/orders?showExtra=true", "B2B order records"),
    captureOptionalB2BCollection(environment, "/invoices", "B2B invoices"),
    captureOptionalB2BCollection(environment, "/payments", "B2B payments"),
    captureOptionalB2BCollection(environment, "/sales-reps", "B2B sales representatives"),
    captureOptionalB2BCollection(environment, "/companies/extra-fields", "B2B Company extra-field definitions"),
    captureOptionalB2BCollection(environment, "/users/extra-fields", "B2B user extra-field definitions"),
    captureOptionalB2BCollection(environment, "/addresses/extra-fields", "B2B address extra-field definitions"),
    captureOptionalB2BCollection(environment, "/orders/extra-fields", "B2B order extra-field definitions"),
    captureOptionalB2BCollection(environment, "/rfq/extra-fields", "B2B quote extra-field definitions"),
  ]);

  const companyValues = Array.isArray(companies.data) ? companies.data : [];
  const userValues = Array.isArray(users.data) ? users.data : [];
  const roleValues = Array.isArray(roleSummaries.data) ? roleSummaries.data : [];
  const quoteValues = Array.isArray(quotes.data) ? quotes.data : [];
  const roles = roleSummaries.warning
    ? roleSummaries
    : await captureB2BDetails(
        environment,
        roleValues,
        ["id", "roleId"],
        (id) => `/companies/roles/${id}`,
        "B2B Company roles",
      );
  const companyDetails = companies.warning
    ? companies
    : await captureB2BDetails(
        environment,
        companyValues,
        ["companyId", "id"],
        (id) => `/companies/${id}`,
        "B2B Company details",
      );
  const userDetails = users.warning
    ? users
    : await captureB2BDetails(
        environment,
        userValues,
        ["id", "userId"],
        (id) => `/users/${id}`,
        "B2B Company user details",
      );
  const quoteDetails = quotes.warning
    ? quotes
    : await captureB2BDetails(
        environment,
        quoteValues,
        ["quoteId", "id"],
        (id) => `/rfq/${id}`,
        "B2B quote details",
      );
  const detailWarnings: string[] = [];
  const orderValues = Array.isArray(orders.data) ? orders.data : [];
  const orderDetails = orders.warning
    ? orders
    : capturedResource(
        "B2B order details and products",
        "store",
        await mapInBatches(orderValues, async (value) => {
          const order = asRecord(value);
          const id = readPositiveInteger(order?.bcOrderId ?? order?.orderId);
          if (!id) return value;
          try {
            const [details, products] = await Promise.all([
              fetchB2BJson(environment, `/orders/${id}`, `B2B order ${id}`),
              fetchB2BJson(environment, `/orders/${id}/products`, `products for B2B order ${id}`),
            ]);
            return {
              ...order,
              details: asRecord(details)?.data ?? details,
              products: asRecord(products)?.data ?? products,
            };
          } catch (error) {
            detailWarnings.push(error instanceof Error ? error.message : `B2B order ${id} failed.`);
            return value;
          }
        }),
        detailWarnings.length > 0
          ? `${detailWarnings.length} B2B orders could not be fully expanded; their list records were retained.`
          : undefined,
      );

  const hierarchies = capturedResource(
    "B2B Company hierarchies",
    "store",
    companyValues.flatMap((value) => {
      const company = asRecord(value);
      const companyId = readPositiveInteger(company?.companyId ?? company?.id);
      const parent = asRecord(company?.parentCompany);
      const parentCompanyId = readPositiveInteger(
        parent?.companyId ?? parent?.id ?? company?.parentCompanyId,
      );
      return companyId && parentCompanyId ? [{ companyId, parentCompanyId }] : [];
    }),
  );

  const shoppingLists: unknown[] = [];
  const shoppingWarnings: string[] = [];
  for (const user of userValues) {
    const userId = readPositiveInteger(asRecord(user)?.id ?? asRecord(user)?.userId);
    if (!userId) continue;
    try {
      const lists = await fetchB2BCollection(
        environment,
        `/shopping-list?userId=${userId}`,
        `shopping lists for B2B user ${userId}`,
      );
      shoppingLists.push(...lists);
    } catch (error) {
      shoppingWarnings.push(error instanceof Error ? error.message : `Shopping lists for user ${userId} failed.`);
    }
  }
  const uniqueShoppingLists = [...new Map(shoppingLists.map((value) => {
    const record = asRecord(value);
    return [String(record?.id ?? record?.shoppingListId ?? JSON.stringify(value)), value];
  })).values()];
  const shoppingListDetails = await mapInBatches(uniqueShoppingLists, async (value) => {
    const id = readPositiveInteger(asRecord(value)?.id ?? asRecord(value)?.shoppingListId);
    if (!id) return value;
    try {
      const payload = await fetchB2BJson(
        environment,
        `/shopping-list/${id}`,
        `shopping list ${id}`,
      );
      return asRecord(payload)?.data ?? value;
    } catch (error) {
      shoppingWarnings.push(error instanceof Error ? error.message : `Shopping list ${id} failed.`);
      return value;
    }
  });

  const attachments: unknown[] = [];
  const attachmentWarnings: string[] = [];
  for (const company of companyValues) {
    const companyId = readPositiveInteger(asRecord(company)?.companyId ?? asRecord(company)?.id);
    if (!companyId) continue;
    try {
      const values = await fetchB2BCollection(
        environment,
        `/companies/${companyId}/attachments`,
        `attachments for B2B Company ${companyId}`,
      );
      attachments.push(...values.flatMap((value) => {
        const attachment = asRecord(value);
        return attachment ? [{ companyId, ...attachment }] : [];
      }));
    } catch (error) {
      attachmentWarnings.push(error instanceof Error ? error.message : `Attachments for Company ${companyId} failed.`);
    }
  }

  return {
    resources: {
      permissions,
      roles,
      companies,
      companyDetails,
      users,
      userDetails,
      addresses,
      hierarchies,
      quotes: quoteDetails,
      orders: orderDetails,
      invoices,
      payments,
      shoppingLists: capturedResource(
        "B2B shopping lists",
        "store",
        shoppingListDetails,
        shoppingWarnings.length > 0
          ? `${shoppingWarnings.length} user shopping-list collections could not be captured.`
          : undefined,
      ),
      attachments: capturedResource(
        "B2B Company attachment metadata",
        "store",
        attachments,
        attachmentWarnings.length > 0
          ? `${attachmentWarnings.length} Company attachment collections could not be captured.`
          : undefined,
      ),
      salesReps,
      companyExtraFields,
      userExtraFields,
      addressExtraFields,
      orderExtraFields,
      quoteExtraFields,
    },
  };
}

async function isB2BEnabledForChannel(
  environment: ConnectedEnvironment,
  channelId: number,
) {
  try {
    const payload = await fetchB2BJson(
      environment,
      `/channels/${channelId}`,
      `B2B channel ${channelId}`,
    );
    const channel = asRecord(asRecord(payload)?.data);
    return channel?.b2bEnabled === true;
  } catch {
    // A channel that is not registered with B2B Edition returns no B2B channel
    // details. Missing B2B scope is also treated as unavailable rather than
    // risking the capture of store-wide business data for a B2C snapshot.
    return false;
  }
}

async function captureOptionalGraphql(
  environment: ConnectedEnvironment,
  query: string,
  variables: Record<string, unknown>,
  label: string,
) {
  try {
    const response = await queueStoreRequest(environment.storeHash, () =>
      fetch(
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
      ),
    );
    const payload = (await response.json()) as unknown;
    const errors = asRecord(payload)?.errors;
    if (!response.ok || (Array.isArray(errors) && errors.length > 0)) {
      throw new SnapshotCaptureError(`BigCommerce did not return ${label}.`);
    }
    return capturedResource(label, "channel", payload);
  } catch (error) {
    return capturedResource(
      label,
      "channel",
      null,
      error instanceof Error ? error.message : `Unable to capture ${label}.`,
    );
  }
}

async function captureTranslationCollection(
  environment: ConnectedEnvironment,
  channelId: number,
  localeCode: string,
  resourceType: "PRODUCTS" | "CATEGORIES",
) {
  const label = `${resourceType === "PRODUCTS" ? "product" : "category"} translations for ${localeCode}`;
  const edges: unknown[] = [];
  let after: string | null = null;
  while (true) {
    const page = await captureOptionalGraphql(
      environment,
      `query SnapshotTranslations($channelId: ID!, $localeId: ID!, $after: String) { store { translations(filters: { resourceType: ${resourceType}, channelId: $channelId, localeId: $localeId } first: 50 after: $after) { edges { node { resourceId fields { fieldName original translation } } cursor } pageInfo { hasNextPage endCursor } } } }`,
      {
        channelId: `bc/store/channel/${channelId}`,
        localeId: `bc/store/locale/${localeCode}`,
        after,
      },
      label,
    );
    if (page.warning) return page;
    const store = asRecord(asRecord(asRecord(page.data)?.data)?.store);
    const translations = asRecord(store?.translations);
    const pageEdges = translations?.edges;
    if (Array.isArray(pageEdges)) edges.push(...pageEdges);
    const pageInfo = asRecord(translations?.pageInfo);
    const endCursor = readString(pageInfo?.endCursor);
    if (!pageInfo?.hasNextPage || !endCursor) break;
    after = endCursor;
  }
  return capturedResource(label, "channel", { localeCode, edges });
}

function unwrapData(value: CapturedConfigurationResource) {
  return asRecord(value.data)?.data ?? value.data;
}

async function loadSnapshotConfiguration(
  environment: ConnectedEnvironment,
  channelId: number,
  channel: JsonRecord,
  onProgress?: SnapshotProgress,
): Promise<CapturedSnapshotConfiguration> {
  await onProgress?.("Capturing channel and storefront configuration", 89, 100);
  const hasStencilTheme = readString(channel.platform).trim().toLowerCase() === "bigcommerce";
  const [channelMetafields, site, activeTheme] = await Promise.all([
    captureOptionalCollection(
      environment,
      `/v3/channels/${channelId}/metafields`,
      "channel metafields",
      "channel",
    ),
    captureOptionalJson(
      environment,
      `/v3/channels/${channelId}/site`,
      "channel site",
      "site",
    ),
    hasStencilTheme
      ? captureOptionalJson(
          environment,
          `/v3/channels/${channelId}/active-theme`,
          "active theme",
          "channel",
        )
      : Promise.resolve(capturedResource("active theme", "channel", null)),
  ]);
  const siteId = readPositiveInteger(asRecord(unwrapData(site))?.id);
  const activeThemeData = asRecord(unwrapData(activeTheme));
  const activeThemeUuid = readString(activeThemeData?.active_theme_uuid);
  const [siteRoutes, themeConfiguration] = await Promise.all([
    siteId
      ? captureOptionalCollection(
          environment,
          `/v3/sites/${siteId}/routes`,
          "site routes",
          "site",
        )
      : Promise.resolve(capturedResource("site routes", "site", [])),
    activeThemeUuid
      ? captureOptionalCollection(
          environment,
          `/v3/themes/${encodeURIComponent(activeThemeUuid)}/configurations?channel_id:in=${channelId}`,
          "theme configuration",
          "channel",
        )
      : Promise.resolve(capturedResource("theme configuration", "channel", [])),
  ]);

  await onProgress?.("Capturing effective storefront settings", 90, 100);
  const storefrontEntries = await Promise.all([
    ["profile", "/v3/settings/store/profile", "store profile settings"],
    ["logo", "/v3/settings/logo", "logo and favicon settings"],
    ["seo", "/v3/settings/storefront/seo", "storefront SEO settings"],
    ["robots", "/v3/settings/storefront/robotstxt", "robots.txt settings"],
    ["productDisplay", "/v3/settings/storefront/product", "storefront product settings"],
    ["categoryDisplay", "/v3/settings/storefront/category", "storefront category settings"],
    ["catalogPreferences", "/v3/settings/catalog", "catalog preference settings"],
    ["inventoryRules", "/v3/settings/inventory", "channel inventory rules"],
    ["search", "/v3/settings/storefront/search", "storefront search settings"],
    ["statusMessages", "/v3/settings/storefront/status", "storefront status messages"],
  ].map(async ([key, path, label]) => [
    key,
    await captureEffectiveChannelSettings(
      environment,
      path,
      `${path}?channel_id=${channelId}`,
      label,
    ),
  ] as const));
  const [customerPrivacy, customerGroups] = await Promise.all([
    captureEffectiveChannelSettings(
      environment,
      "/v3/customers/settings",
      `/v3/customers/settings/channels/${channelId}`,
      "customer privacy and group settings",
    ),
    captureOptionalJson(
      environment,
      "/v2/customer_groups",
      "customer groups",
      "store",
    ).then((resource) => ({
      ...resource,
      data: resource.data ?? [],
    })),
  ]);
  await onProgress?.("Capturing checkout and customer experience settings", 91, 100);
  const experienceEntries = await Promise.all([
    ["checkout", `/v3/checkouts/settings/channels/${channelId}`, "checkout settings"],
    ["cart", `/v3/carts/settings/channels/${channelId}`, "cart settings"],
    ["order", `/v3/orders/settings/channels/${channelId}`, "order settings"],
    ["abandonedCart", `/v3/abandoned-carts/settings/channels/${channelId}`, "abandoned-cart settings"],
  ].map(async ([key, path, label]) => [
    key,
    await captureOptionalJson(environment, path, label, "channel"),
  ] as const));

  await onProgress?.("Capturing currency and price-list configuration", 91, 100);
  const [currencyAssignments, storeCurrencies, priceListAssignments] = await Promise.all([
    captureOptionalJson(
      environment,
      `/v3/channels/${channelId}/currency-assignments`,
      "currency assignments",
      "channel",
    ),
    captureOptionalJson(
      environment,
      "/v2/currencies",
      "store currencies",
      "store",
    ),
    captureOptionalCollection(
      environment,
      `/v3/pricelists/assignments?channel_id=${channelId}`,
      "price-list assignments",
      "channel",
    ),
  ]);
  const assignments = Array.isArray(priceListAssignments.data)
    ? priceListAssignments.data
    : [];
  const priceListIds = [...new Set(assignments.flatMap((value) => {
    const id = readPositiveInteger(asRecord(value)?.price_list_id);
    return id ? [id] : [];
  }))];
  const priceLists: unknown[] = [];
  const priceListRecords: Record<string, unknown[]> = {};
  for (const priceListId of priceListIds) {
    const definition = await captureOptionalJson(
      environment,
      `/v3/pricelists/${priceListId}`,
      `price list ${priceListId}`,
      "store",
    );
    if (!definition.warning) priceLists.push(unwrapData(definition));
    const records = await captureOptionalCollection(
      environment,
      `/v3/pricelists/${priceListId}/records`,
      `price-list ${priceListId} records`,
      "store",
    );
    priceListRecords[String(priceListId)] = Array.isArray(records.data)
      ? records.data
      : [];
  }

  await onProgress?.("Capturing shipping configuration", 92, 100);
  const [channelShipping, shippingZones] = await Promise.all([
    captureOptionalJson(
      environment,
      `/v3/shipping/settings/channels/${channelId}`,
      "channel shipping settings",
      "channel",
    ),
    captureOptionalJson(
      environment,
      "/v2/shipping/zones",
      "shipping zones",
      "store",
    ),
  ]);
  const zoneValues = Array.isArray(shippingZones.data) ? shippingZones.data : [];
  const shippingMethods: Record<string, unknown> = {};
  for (const zone of zoneValues) {
    const zoneId = readPositiveInteger(asRecord(zone)?.id);
    if (!zoneId) continue;
    const methods = await captureOptionalJson(
      environment,
      `/v2/shipping/zones/${zoneId}/methods`,
      `shipping methods for zone ${zoneId}`,
      "store",
    );
    shippingMethods[String(zoneId)] = methods.data;
  }

  await onProgress?.("Capturing tax configuration", 93, 100);
  const [taxSettings, taxZones, taxRates] = await Promise.all([
    captureOptionalJson(environment, "/v3/tax/settings", "tax settings", "store"),
    captureOptionalCollection(environment, "/v3/tax/zones", "tax zones", "store"),
    captureOptionalCollection(environment, "/v3/tax/rates", "tax rates", "store"),
  ]);

  await onProgress?.("Checking whether B2B Edition is enabled for this channel", 94, 100);
  const b2bEnabled = await isB2BEnabledForChannel(environment, channelId);
  const b2b = b2bEnabled
    ? await captureB2BConfiguration(environment)
    : undefined;
  await onProgress?.(
    b2bEnabled
      ? "Captured B2B Edition Companies, users, roles, and business records"
      : "Skipping B2B Edition data: this channel is not B2B enabled",
    94,
    100,
  );

  await onProgress?.("Capturing locales, translations, and presentation metadata", 95, 100);
  const [globalStoreLocale, channelStoreLocale, channelLocales, inventorySettings, locations, scripts] = await Promise.all([
    captureOptionalJson(
      environment,
      "/v3/settings/store/locale",
      "global store locale settings",
      "store",
    ),
    captureOptionalJson(
      environment,
      `/v3/settings/store/locale?channel_id=${channelId}`,
      "channel locale settings",
      "channel",
    ),
    captureOptionalGraphql(
      environment,
      `query ChannelLocales($channelId: ID!) { store { locales(input: { channelId: $channelId }) { edges { node { code status isDefault } } } } }`,
      { channelId: `bc/store/channel/${channelId}` },
      "channel locales",
    ),
    captureOptionalJson(
      environment,
      "/v3/settings/inventory",
      "inventory settings",
      "store",
    ),
    captureOptionalCollection(
      environment,
      "/v3/inventory/locations",
      "inventory locations",
      "store",
    ),
    captureOptionalCollection(
      environment,
      `/v3/content/scripts?channel_id=${channelId}`,
      "channel scripts",
      "channel",
    ),
  ]);
  const globalLocaleData = asRecord(unwrapData(globalStoreLocale));
  const channelLocaleData = asRecord(unwrapData(channelStoreLocale));
  const storeCountry =
    readString(channelLocaleData?.store_country) ||
    readString(globalLocaleData?.store_country);
  const defaultShopperLanguage =
    readString(channelLocaleData?.default_shopper_language) ||
    readString(globalLocaleData?.default_shopper_language);
  const storeLocale = capturedResource(
    "channel locale defaults",
    "channel",
    {
      ...(storeCountry ? { store_country: storeCountry } : {}),
      ...(defaultShopperLanguage
        ? { default_shopper_language: defaultShopperLanguage }
        : {}),
    },
    channelStoreLocale.warning && globalStoreLocale.warning
      ? channelStoreLocale.warning
      : undefined,
  );
  const localePayload = asRecord(channelLocales.data);
  const localeStore = asRecord(asRecord(localePayload?.data)?.store);
  const localeEdges = asRecord(localeStore?.locales)?.edges;
  const localeCodes = Array.isArray(localeEdges)
    ? localeEdges.flatMap((edge) => {
        const code = readString(asRecord(asRecord(edge)?.node)?.code);
        return code ? [code] : [];
      })
    : [];
  const translations: Record<string, { products: unknown; categories: unknown }> = {};
  for (const localeCode of localeCodes) {
    const [products, categories] = await Promise.all([
      captureTranslationCollection(
        environment,
        channelId,
        localeCode,
        "PRODUCTS",
      ),
      captureTranslationCollection(
        environment,
        channelId,
        localeCode,
        "CATEGORIES",
      ),
    ]);
    translations[localeCode] = { products, categories };
  }

  const group = (
    resources: CapturedConfigurationGroup["resources"],
  ): CapturedConfigurationGroup => ({ resources });
  const scriptMetadata = {
    ...scripts,
    data: Array.isArray(scripts.data)
      ? scripts.data.flatMap((value) => {
          const script = asRecord(value);
          return script
            ? [pickFields(script, [
                "id", "name", "description", "src", "kind", "location",
                "visibility", "consent_category", "enabled", "auto_uninstall",
              ])]
            : [];
        })
      : [],
  };

  return {
    channel: group({ channelMetafields, site, siteRoutes, activeTheme }),
    storefront: group({
      ...Object.fromEntries(storefrontEntries),
      customerPrivacy,
      customerGroups,
    }),
    experience: group(Object.fromEntries(experienceEntries)),
    pricing: group({
      currencyAssignments,
      storeCurrencies,
      priceListAssignments,
      priceLists: capturedResource("assigned price lists", "store", priceLists),
      priceListRecords: capturedResource("assigned price-list records", "store", priceListRecords),
    }),
    shipping: group({
      channelShipping,
      shippingZones,
      shippingMethods: capturedResource("shipping methods", "store", shippingMethods),
    }),
    tax: group({
      taxSettings,
      taxZones,
      taxRates,
      taxClasses: capturedResource("tax classes", "store", []),
    }),
    inventory: group({ inventorySettings, locations }),
    ...(b2b ? { b2b } : {}),
    localization: group({
      storeLocale,
      channelLocales,
      productTranslations: capturedResource(
        "product translations",
        "channel",
        Object.fromEntries(Object.entries(translations).map(([locale, value]) => [locale, value.products])),
      ),
      categoryTranslations: capturedResource(
        "category translations",
        "channel",
        Object.fromEntries(Object.entries(translations).map(([locale, value]) => [locale, value.categories])),
      ),
      activeTheme,
      themeConfiguration,
      scripts: scriptMetadata,
    }),
  };
}

function countProductChildren(products: SnapshotProductRecord[]) {
  let variantCount = 0;
  let imageCount = 0;
  let metafieldCount = 0;

  for (const product of products) {
    variantCount += Array.isArray(product.data.variants)
      ? product.data.variants.length
      : 0;
    imageCount += Array.isArray(product.data.images)
      ? product.data.images.length
      : 0;
    metafieldCount += product.metafields.length;
    metafieldCount += product.variantMetafields.reduce(
      (total, variant) => total + variant.data.length,
      0,
    );
  }

  return { variantCount, imageCount, metafieldCount };
}

export async function createCatalogSnapshot(input: {
  environmentId: number;
  channelId: number;
  name: string;
  confirmedSnapshotId?: number;
  userId?: string;
  onProgress?: SnapshotProgress;
}) {
  const userId = input.userId ?? (await requireAppUser()).id;
  const environment = await getBigCommerceEnvironmentConnection(
    userId,
    input.environmentId,
  );

  if (!environment) {
    throw new SnapshotCaptureError("The selected environment was not found.");
  }

  if (!environment.accessToken) {
    throw new SnapshotCaptureError(
      "The saved token could not be decrypted. Re-save it in Settings.",
    );
  }

  const existingSnapshot = await getLatestCatalogSnapshotByName(
    userId,
    input.name,
  );

  if (
    existingSnapshot &&
    input.confirmedSnapshotId !== existingSnapshot.id
  ) {
    throw new SnapshotVersionConfirmationRequired(existingSnapshot);
  }

  const snapshotName = existingSnapshot?.name ?? input.name;

  const connectedEnvironment = {
    ...environment,
    accessToken: environment.accessToken,
  };

  try {
    await input.onProgress?.("Loading source channel details", 3, 100);
    const channel = await loadChannel(connectedEnvironment, input.channelId);
    const channelName = readString(channel.name);
    await input.onProgress?.(`Capturing channel: ${channelName}`, 5, 100);
    const categoryData = await loadCategoryData(
      connectedEnvironment,
      input.channelId,
      input.onProgress,
    );
    const products = await loadProductData(
      connectedEnvironment,
      input.channelId,
      input.onProgress,
    );
    await input.onProgress?.("Capturing brands, tax classes, and store currency", 88, 100);
    const supportingData = await loadSupportingData(connectedEnvironment);
    const configuration = await loadSnapshotConfiguration(
      connectedEnvironment,
      input.channelId,
      channel,
      input.onProgress,
    );
    if (configuration.tax) {
      configuration.tax.resources.taxClasses = capturedResource(
        "tax classes",
        "store",
        supportingData.taxClasses,
      );
    }
    const previewCategories = categoryData.categoryTree.flatMap((value) => {
      const category = parsePreviewCategory(value);
      return category ? [category] : [];
    });
    const previewProducts = products.flatMap((product) => {
      const preview = toPreviewProduct(product.data);
      return preview ? [preview] : [];
    });
    const productCounts = countProductChildren(products);
    const categoryMetafieldCount = categoryData.categories.reduce(
      (total, category) => total + category.metafields.length,
      0,
    );
    const manifest: CatalogSnapshotManifestV1 = {
      formatVersion: FORMAT_VERSION,
      capturedAt: new Date().toISOString(),
      source: {
        environmentId: environment.id,
        environmentName: environment.name,
        storeHash: environment.storeHash,
        channelId: input.channelId,
        channelName,
      },
      store: supportingData.store,
      catalog: {
        channel,
        tree: categoryData.tree,
        categoryTree: categoryData.categoryTree,
        categories: categoryData.categories,
        brands: supportingData.brands,
        taxClasses: supportingData.taxClasses,
        products,
      },
      configuration,
      preview: {
        currency: supportingData.store.currency,
        categories: previewCategories,
        products: previewProducts,
      },
    };
    const payloadJson = JSON.stringify(manifest);
    await input.onProgress?.(
      `Saving manifest: ${categoryData.categories.length} categories · ${products.length} products · ${productCounts.variantCount} variants · ${productCounts.imageCount} images`,
      97,
      100,
    );

    const savedSnapshot = await addCatalogSnapshot(userId, {
      name: snapshotName,
      formatVersion: FORMAT_VERSION,
      sourceEnvironmentId: environment.id,
      sourceEnvironmentName: environment.name,
      sourceStoreHash: environment.storeHash,
      sourceChannelId: input.channelId,
      sourceChannelName: channelName,
      categoryCount: categoryData.categories.length,
      productCount: products.length,
      variantCount: productCounts.variantCount,
      imageCount: productCounts.imageCount,
      metafieldCount: productCounts.metafieldCount + categoryMetafieldCount,
      payloadBytes: Buffer.byteLength(payloadJson, "utf8"),
      payloadJson,
    });

    await input.onProgress?.(`Snapshot saved as version ${savedSnapshot.snapshotVersion}`, 100, 100);

    return savedSnapshot.id;
  } catch (error) {
    if (error instanceof SnapshotVersionConfirmationRequired) {
      throw error;
    }

    throw new SnapshotCaptureError(getRequestErrorMessage(error));
  }
}

async function updateWorkflowCaptureProgress(
  userId: string,
  operationId: number,
  currentStep: string,
  stepIndex: number,
) {
  const operation = await getCatalogOperation(userId, operationId);
  if (!operation || operation.status === "cancelled") {
    throw new SnapshotCaptureError("Snapshot capture was cancelled.");
  }
  if (operation.status === "failed") {
    throw new SnapshotCaptureError(
      operation.error || "Snapshot capture is no longer active.",
    );
  }
  await updateCatalogOperation(userId, operationId, {
    status: "running",
    currentStep,
    stepIndex,
    totalSteps: 100,
  });
}

export async function prepareWorkflowCatalogSnapshot(
  userId: string,
  operationId: number,
) {
  const staged = await getCatalogSnapshotCaptureState(userId, operationId);
  if (staged) {
    return {
      nextCategoryIndex: staged.nextCategoryIndex,
      totalCategories: staged.totalCategories,
    };
  }

  const operation = await getCatalogOperation(userId, operationId);
  if (!operation || operation.kind !== "snapshot") {
    throw new SnapshotCaptureError("Snapshot operation was not found.");
  }
  if (!["queued", "running"].includes(operation.status)) {
    throw new SnapshotCaptureError("Snapshot capture is no longer active.");
  }
  const payload = JSON.parse(operation.payloadJson) as Record<string, unknown>;
  const environmentId = Number(payload.environmentId);
  const channelId = Number(payload.channelId);
  const requestedName = readString(payload.name).trim();
  const confirmedSnapshotId = payload.confirmedSnapshotId
    ? Number(payload.confirmedSnapshotId)
    : undefined;
  if (
    !Number.isSafeInteger(environmentId) ||
    environmentId < 1 ||
    !Number.isSafeInteger(channelId) ||
    channelId < 1 ||
    !requestedName
  ) {
    throw new SnapshotCaptureError("Snapshot operation details are invalid.");
  }

  const environment = await getBigCommerceEnvironmentConnection(
    userId,
    environmentId,
  );
  if (!environment) {
    throw new SnapshotCaptureError("The selected environment was not found.");
  }
  if (!environment.accessToken) {
    throw new SnapshotCaptureError(
      "The saved token could not be decrypted. Re-save it in Settings.",
    );
  }
  const existingSnapshot = await getLatestCatalogSnapshotByName(
    userId,
    requestedName,
  );
  if (existingSnapshot && confirmedSnapshotId !== existingSnapshot.id) {
    throw new SnapshotVersionConfirmationRequired(existingSnapshot);
  }
  const snapshotName = existingSnapshot?.name ?? requestedName;
  const connectedEnvironment = {
    ...environment,
    accessToken: environment.accessToken,
  };
  const progress = (currentStep: string, stepIndex = 0) =>
    updateWorkflowCaptureProgress(
      userId,
      operationId,
      currentStep,
      stepIndex,
    );

  await progress("Loading source channel details", 3);
  const channel = await loadChannel(connectedEnvironment, channelId);
  const channelName = readString(channel.name);
  await progress(`Capturing channel: ${channelName}`, 5);
  const categorySeed = await loadCategorySeed(
    connectedEnvironment,
    channelId,
    progress,
  );
  const state = await initializeCatalogSnapshotCategoryState({
    operationId,
    userId,
    snapshotName,
    environmentId,
    channelId,
    channelJson: JSON.stringify(channel),
    categoryDataJson: JSON.stringify({
      tree: categorySeed.tree,
      categoryTree: categorySeed.categoryTree,
      categories: [],
    } satisfies SnapshotCategoryData),
    categoryRecordsJson: JSON.stringify(categorySeed.categoryRecords),
    totalCategories: categorySeed.categoryRecords.length,
  });
  await progress(
    state.totalCategories > 0
      ? `Ready to capture ${state.totalCategories} categories in resumable batches`
      : "No categories are assigned to this channel",
    state.totalCategories > 0 ? 14 : 27,
  );
  return {
    nextCategoryIndex: state.nextCategoryIndex,
    totalCategories: state.totalCategories,
  };
}

export async function captureWorkflowCatalogSnapshotCategoryBatch(
  userId: string,
  operationId: number,
) {
  const state = await getCatalogSnapshotCaptureState(userId, operationId);
  if (!state) throw new SnapshotCaptureError("Snapshot capture state was not found.");
  const operation = await getCatalogOperation(userId, operationId);
  if (!operation || !["queued", "running"].includes(operation.status)) {
    throw new SnapshotCaptureError("Snapshot capture was cancelled.");
  }
  const categoryRecords = JSON.parse(state.categoryRecordsJson) as JsonRecord[];
  const startIndex = state.nextCategoryIndex;
  const totalCategories = state.totalCategories;
  if (startIndex >= totalCategories) {
    return { nextCategoryIndex: startIndex, totalCategories };
  }
  const endIndex = Math.min(
    startIndex + WORKFLOW_CATEGORY_BATCH_SIZE,
    totalCategories,
  );
  const environment = await getBigCommerceEnvironmentConnection(
    userId,
    state.environmentId,
  );
  if (!environment?.accessToken) {
    throw new SnapshotCaptureError(
      "The source environment or its access token is no longer available.",
    );
  }
  const connectedEnvironment = {
    ...environment,
    accessToken: environment.accessToken,
  };
  const progress = (currentStep: string, stepIndex = 0) =>
    updateWorkflowCaptureProgress(userId, operationId, currentStep, stepIndex);
  await progress(
    `Loading category records ${startIndex + 1}–${endIndex} of ${totalCategories}`,
    15 + Math.round((startIndex / Math.max(totalCategories, 1)) * 12),
  );
  const categories = await captureCategoryRecords(
    connectedEnvironment,
    categoryRecords.slice(startIndex, endIndex),
    progress,
    startIndex,
    totalCategories,
  );
  const categoryData = JSON.parse(state.categoryDataJson) as SnapshotCategoryData;
  categoryData.categories = categoryData.categories.concat(categories);
  await saveCatalogSnapshotCategoryBatch({
    userId,
    operationId,
    startCategoryIndex: startIndex,
    nextCategoryIndex: endIndex,
    categoryDataJson: JSON.stringify(categoryData),
  });
  return { nextCategoryIndex: endIndex, totalCategories };
}

export async function completeWorkflowCatalogSnapshotInitialization(
  userId: string,
  operationId: number,
) {
  const staged = await getCatalogSnapshotCaptureState(userId, operationId);
  if (!staged) throw new SnapshotCaptureError("Snapshot capture state was not found.");
  if (staged.initializationComplete) {
    return {
      nextProductIndex: staged.nextProductIndex,
      totalProducts: staged.totalProducts,
    };
  }
  if (staged.nextCategoryIndex < staged.totalCategories) {
    throw new SnapshotCaptureError("Snapshot category capture is incomplete.");
  }
  const operation = await getCatalogOperation(userId, operationId);
  if (!operation || !["queued", "running"].includes(operation.status)) {
    throw new SnapshotCaptureError("Snapshot capture was cancelled.");
  }
  const environment = await getBigCommerceEnvironmentConnection(
    userId,
    staged.environmentId,
  );
  if (!environment?.accessToken) {
    throw new SnapshotCaptureError(
      "The source environment or its access token is no longer available.",
    );
  }
  const connectedEnvironment = {
    ...environment,
    accessToken: environment.accessToken,
  };
  const channel = asRecord(JSON.parse(staged.channelJson));
  if (!channel) throw new SnapshotCaptureError("Snapshot channel data is invalid.");
  const progress = (currentStep: string, stepIndex = 0) =>
    updateWorkflowCaptureProgress(userId, operationId, currentStep, stepIndex);
  await progress("Resolving products assigned to this channel", 28);
  const productIds = await loadChannelProductIds(
    connectedEnvironment,
    staged.channelId,
  );
  await progress("Capturing brands, tax classes, and store currency", 30);
  const supportingData = await loadSupportingData(connectedEnvironment);
  const configuration = await loadSnapshotConfiguration(
    connectedEnvironment,
    staged.channelId,
    channel,
    progress,
  );
  if (configuration.tax) {
    configuration.tax.resources.taxClasses = capturedResource(
      "tax classes",
      "store",
      supportingData.taxClasses,
    );
  }
  const state = await completeCatalogSnapshotCaptureInitialization({
    userId,
    operationId,
    supportingDataJson: JSON.stringify({ ...supportingData, configuration }),
    productIdsJson: JSON.stringify(productIds),
    totalProducts: productIds.length,
  });
  await progress(
    productIds.length > 0
      ? `Ready to capture ${productIds.length} products in resumable batches`
      : "No products are assigned to this channel",
    productIds.length > 0 ? 32 : 88,
  );
  return {
    nextProductIndex: state.nextProductIndex,
    totalProducts: state.totalProducts,
  };
}

export async function captureWorkflowCatalogSnapshotProductBatch(
  userId: string,
  operationId: number,
) {
  const state = await getCatalogSnapshotCaptureState(userId, operationId);
  if (!state) throw new SnapshotCaptureError("Snapshot capture state was not found.");
  if (!state.initializationComplete) {
    throw new SnapshotCaptureError("Snapshot initialization is incomplete.");
  }
  const operation = await getCatalogOperation(userId, operationId);
  if (!operation || !["queued", "running"].includes(operation.status)) {
    throw new SnapshotCaptureError("Snapshot capture was cancelled.");
  }
  const productIds = JSON.parse(state.productIdsJson) as number[];
  const startIndex = state.nextProductIndex;
  if (startIndex >= productIds.length) {
    return { nextProductIndex: startIndex, totalProducts: productIds.length };
  }
  const endIndex = Math.min(
    startIndex + WORKFLOW_PRODUCT_BATCH_SIZE,
    productIds.length,
  );
  const batchIds = productIds.slice(startIndex, endIndex);
  const environment = await getBigCommerceEnvironmentConnection(
    userId,
    state.environmentId,
  );
  if (!environment?.accessToken) {
    throw new SnapshotCaptureError(
      "The source environment or its access token is no longer available.",
    );
  }
  const connectedEnvironment = {
    ...environment,
    accessToken: environment.accessToken,
  };
  await updateWorkflowCaptureProgress(
    userId,
    operationId,
    `Loading product records ${startIndex + 1}–${endIndex} of ${productIds.length}`,
    32 + Math.round((startIndex / Math.max(productIds.length, 1)) * 56),
  );
  const rawProducts = (
    await fetchV3Collection(
      connectedEnvironment,
      `/v3/catalog/products?id:in=${batchIds.join(",")}&include=${PRODUCT_INCLUDES}`,
      "products",
    )
  ).flatMap((value) => {
    const product = asRecord(value);
    return product ? [product] : [];
  });
  const productsById = new Map(
    rawProducts.flatMap((product) => {
      const productId = readPositiveInteger(product.id);
      return productId ? [[productId, product] as const] : [];
    }),
  );
  const products = batchIds.flatMap((productId) => {
    const product = productsById.get(productId);
    return product ? [product] : [];
  });
  const enrichedProducts: SnapshotProductRecord[] = [];
  for (let offset = 0; offset < products.length; offset += 1) {
    const product = products[offset];
    const absoluteIndex = startIndex + offset;
    const name =
      readString(product.name) ||
      `product #${readPositiveInteger(product.id) ?? "unknown"}`;
    const variantCount = Array.isArray(product.variants)
      ? product.variants.length
      : 0;
    const imageCount = Array.isArray(product.images) ? product.images.length : 0;
    await updateWorkflowCaptureProgress(
      userId,
      operationId,
      `Capturing product ${absoluteIndex + 1} of ${productIds.length}: ${name} · ${variantCount} variants · ${imageCount} images · metadata`,
      32 +
        Math.round(
          ((absoluteIndex + 1) / Math.max(productIds.length, 1)) * 56,
        ),
    );
    enrichedProducts.push(await enrichProduct(connectedEnvironment, product));
  }
  await saveCatalogSnapshotProductBatch({
    userId,
    operationId,
    startIndex,
    nextProductIndex: endIndex,
    productsJson: enrichedProducts.map((product) => JSON.stringify(product)),
  });
  return { nextProductIndex: endIndex, totalProducts: productIds.length };
}

export async function finalizeWorkflowCatalogSnapshot(
  userId: string,
  operationId: number,
) {
  const operation = await getCatalogOperation(userId, operationId);
  if (operation?.snapshotId) return operation.snapshotId;
  if (!operation || !["queued", "running"].includes(operation.status)) {
    throw new SnapshotCaptureError("Snapshot capture was cancelled.");
  }
  const state = await getCatalogSnapshotCaptureState(userId, operationId);
  if (!state) throw new SnapshotCaptureError("Snapshot capture state was not found.");
  if (!state.initializationComplete) {
    throw new SnapshotCaptureError("Snapshot initialization is incomplete.");
  }
  if (state.nextProductIndex < state.totalProducts) {
    throw new SnapshotCaptureError("Snapshot product capture is incomplete.");
  }
  const environment = await getBigCommerceEnvironmentConnection(
    userId,
    state.environmentId,
  );
  if (!environment) {
    throw new SnapshotCaptureError("The source environment was not found.");
  }
  const channel = asRecord(JSON.parse(state.channelJson));
  if (!channel) throw new SnapshotCaptureError("Snapshot channel data is invalid.");
  const categoryData = JSON.parse(state.categoryDataJson) as Awaited<
    ReturnType<typeof loadCategoryData>
  >;
  const supportingData = JSON.parse(state.supportingDataJson) as Awaited<
    ReturnType<typeof loadSupportingData>
  > & { configuration?: CapturedSnapshotConfiguration };
  const products = (
    await getCatalogSnapshotCaptureProducts(operationId)
  ).map((payloadJson) => JSON.parse(payloadJson) as SnapshotProductRecord);
  const previewCategories = categoryData.categoryTree.flatMap((value) => {
    const category = parsePreviewCategory(value);
    return category ? [category] : [];
  });
  const previewProducts = products.flatMap((product) => {
    const preview = toPreviewProduct(product.data);
    return preview ? [preview] : [];
  });
  const productCounts = countProductChildren(products);
  const categoryMetafieldCount = categoryData.categories.reduce(
    (total, category) => total + category.metafields.length,
    0,
  );
  const channelName = readString(channel.name);
  const manifest: CatalogSnapshotManifestV1 = {
    formatVersion: FORMAT_VERSION,
    capturedAt: new Date().toISOString(),
    source: {
      environmentId: environment.id,
      environmentName: environment.name,
      storeHash: environment.storeHash,
      channelId: state.channelId,
      channelName,
    },
    store: supportingData.store,
    catalog: {
      channel,
      tree: categoryData.tree,
      categoryTree: categoryData.categoryTree,
      categories: categoryData.categories,
      brands: supportingData.brands,
      taxClasses: supportingData.taxClasses,
      products,
    },
    configuration: supportingData.configuration,
    preview: {
      currency: supportingData.store.currency,
      categories: previewCategories,
      products: previewProducts,
    },
  };
  const payloadJson = JSON.stringify(manifest);
  await updateWorkflowCaptureProgress(
    userId,
    operationId,
    `Saving manifest: ${categoryData.categories.length} categories · ${products.length} products · ${productCounts.variantCount} variants · ${productCounts.imageCount} images`,
    97,
  );
  return completeCatalogSnapshotCapture(userId, operationId, {
    name: state.snapshotName,
    formatVersion: FORMAT_VERSION,
    sourceEnvironmentId: environment.id,
    sourceEnvironmentName: environment.name,
    sourceStoreHash: environment.storeHash,
    sourceChannelId: state.channelId,
    sourceChannelName: channelName,
    categoryCount: categoryData.categories.length,
    productCount: products.length,
    variantCount: productCounts.variantCount,
    imageCount: productCounts.imageCount,
    metafieldCount: productCounts.metafieldCount + categoryMetafieldCount,
    payloadBytes: Buffer.byteLength(payloadJson, "utf8"),
    payloadJson,
  });
}

export async function failWorkflowCatalogSnapshot(
  userId: string,
  operationId: number,
  message: string,
) {
  const operation = await getCatalogOperation(userId, operationId);
  if (operation && operation.status !== "cancelled" && operation.status !== "completed") {
    await updateCatalogOperation(userId, operationId, {
      status: "failed",
      currentStep: "Failed",
      error: message || "The snapshot workflow failed.",
    });
  }
  await removeCatalogSnapshotCaptureState(operationId);
}

function parsePreviewProducts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const product = asRecord(item);

    if (!product) {
      return [];
    }

    const id = readPositiveInteger(product.id);
    const name = readString(product.name);

    if (!id || !name) {
      return [];
    }

    return [
      {
        id,
        name,
        description: readString(product.description),
        price: readNonNegativeNumber(product.price),
        imageUrl: readImageUrl(product.imageUrl),
        categoryIds: Array.isArray(product.categoryIds)
          ? product.categoryIds.flatMap((categoryId) => {
              const parsedId = readPositiveInteger(categoryId);
              return parsedId ? [parsedId] : [];
            })
          : [],
      },
    ];
  });
}

export async function getCatalogSnapshotView(
  snapshotId: number,
  requestedLocale?: string | null,
): Promise<CatalogSnapshotView | null> {
  const user = await requireAppUser();
  const snapshot = await getAccessibleCatalogSnapshot(user.id, snapshotId);

  if (!snapshot) {
    return null;
  }

  const isOwner = snapshot.ownerUserId === user.id;
  const versions = isOwner
    ? await getCatalogSnapshotVersionsByName(user.id, snapshot.name)
    : [snapshot];

  try {
    const manifest = asRecord(JSON.parse(snapshot.payloadJson));
    const preview = asRecord(manifest?.preview);
    const formatVersion = Number(manifest?.formatVersion);

    if (!preview || formatVersion !== FORMAT_VERSION) {
      throw new Error("Unsupported snapshot format.");
    }

    const categories = Array.isArray(preview.categories)
      ? preview.categories.flatMap((value) => {
          const category = parsePreviewCategory(value);
          return category ? [category] : [];
        })
      : [];
    const currency = readString(preview.currency).toUpperCase();
    const configuration = asRecord(manifest?.configuration);
    const typedConfiguration = manifest?.configuration as
      | CapturedSnapshotConfiguration
      | undefined;
    const localizationResources = typedConfiguration?.localization?.resources;
    const locales = parseCatalogLocales(
      localizationResources?.channelLocales?.data,
    );
    const activeLocale = selectCatalogLocale(locales, requestedLocale);
    const translations = activeLocale && locales.length > 1
      ? applyCatalogTranslations(
          categories,
          parsePreviewProducts(preview.products),
          getSnapshotLocaleTranslations(
            localizationResources?.categoryTranslations?.data,
            activeLocale.code,
          ),
          getSnapshotLocaleTranslations(
            localizationResources?.productTranslations?.data,
            activeLocale.code,
          ),
        )
      : {
          categories,
          products: parsePreviewProducts(preview.products),
        };
    const availableRestoreGroups = SNAPSHOT_RESTORE_GROUPS.flatMap((group) =>
      group.id === "catalog" || asRecord(configuration?.[group.id])
        ? [group.id]
        : [],
    );

    return {
      summary: snapshot,
      versions,
      isOwner,
      categories: translations.categories,
      products: translations.products,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
      locales,
      activeLocale: activeLocale?.code ?? null,
      availableRestoreGroups,
      hasTranslations: hasCapturedTranslations(
        typedConfiguration,
      ),
      error: null,
    };
  } catch {
    return {
      summary: snapshot,
      versions,
      isOwner,
      categories: [],
      products: [],
      currency: "USD",
      locales: [],
      activeLocale: null,
      availableRestoreGroups: ["catalog"],
      hasTranslations: false,
      error: "This snapshot payload is invalid or uses an unsupported format.",
    };
  }
}
