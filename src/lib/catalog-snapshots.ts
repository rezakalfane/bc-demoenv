import "server-only";

import { requireAppUser } from "@/lib/auth";
import type { CatalogCategory, CatalogProduct } from "@/lib/catalog-types";
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
  initializeCatalogSnapshotCaptureState,
  removeCatalogSnapshotCaptureState,
  saveCatalogSnapshotProductBatch,
  updateCatalogOperation,
  type BigCommerceEnvironmentConnection,
  type CatalogSnapshotSummary,
} from "@/lib/db";

const API_BASE_URL = "https://api.bigcommerce.com/stores";
const REQUEST_TIMEOUT_MS = 12_000;
const PAGE_SIZE = 250;
const CAPTURE_CONCURRENCY = 5;
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

  return (await response.json()) as unknown;
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

async function loadCategoryData(
  environment: ConnectedEnvironment,
  channelId: number,
  onProgress?: SnapshotProgress,
) {
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
      categories: [] as SnapshotCategoryRecord[],
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
  const categories: SnapshotCategoryRecord[] = [];
  for (let index = 0; index < categoryRecords.length; index += 1) {
    const category = categoryRecords[index];
    const categoryId = readPositiveInteger(category.category_id);

    if (!categoryId) {
      throw new SnapshotCaptureError(
        "BigCommerce returned a category without a valid ID.",
      );
    }

    const categoryName = readString(category.name) || `category #${categoryId}`;
    await onProgress?.(
      `Capturing category ${index + 1} of ${categoryRecords.length}: ${categoryName}`,
      15 + Math.round(((index + 1) / Math.max(categoryRecords.length, 1)) * 12),
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

  return { tree, categoryTree, categories };
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
    await input.onProgress?.("Capturing brands, tax classes, and store currency", 90, 100);
    const supportingData = await loadSupportingData(connectedEnvironment);
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

export async function initializeWorkflowCatalogSnapshot(
  userId: string,
  operationId: number,
) {
  const staged = await getCatalogSnapshotCaptureState(userId, operationId);
  if (staged) {
    return {
      nextProductIndex: staged.nextProductIndex,
      totalProducts: staged.totalProducts,
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
  const categoryData = await loadCategoryData(
    connectedEnvironment,
    channelId,
    progress,
  );
  await progress("Resolving products assigned to this channel", 28);
  const productIds = await loadChannelProductIds(
    connectedEnvironment,
    channelId,
  );
  await progress("Capturing brands, tax classes, and store currency", 30);
  const supportingData = await loadSupportingData(connectedEnvironment);
  const state = await initializeCatalogSnapshotCaptureState({
    operationId,
    userId,
    snapshotName,
    environmentId,
    channelId,
    channelJson: JSON.stringify(channel),
    categoryDataJson: JSON.stringify(categoryData),
    supportingDataJson: JSON.stringify(supportingData),
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
  >;
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

    return {
      summary: snapshot,
      versions,
      isOwner,
      categories,
      products: parsePreviewProducts(preview.products),
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
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
      error: "This snapshot payload is invalid or uses an unsupported format.",
    };
  }
}
