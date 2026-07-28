import "server-only";

import { requireAppUser } from "@/lib/auth";
import type {
  CatalogCategory,
  CatalogProduct,
  ProductDetailRecord,
} from "@/lib/catalog-types";
import {
  applyCatalogTranslations,
  parseCatalogLocales,
  parseCatalogTranslations,
  selectCatalogLocale,
  type CatalogLocale,
} from "@/lib/catalog-localization";
import {
  getBigCommerceEnvironmentConnection,
  type BigCommerceEnvironmentConnection,
} from "@/lib/db";

const API_BASE_URL = "https://api.bigcommerce.com/stores";
const REQUEST_TIMEOUT_MS = 10_000;
const PRODUCT_PAGE_SIZE = 250;
const MAX_CATEGORY_DEPTH = 20;
const DEFAULT_CURRENCY = "USD";
const CDN_HOST_PATTERN = /^cdn\d+\.bigcommerce\.com$/i;
const READ_RATE_LIMIT_RETRIES = 3;
const PRODUCT_DETAIL_CONCURRENCY = 5;
const PRODUCT_DETAIL_INCLUDES = [
  "variants",
  "images",
  "custom_fields",
  "bulk_pricing_rules",
  "primary_image",
  "videos",
  "options",
  "modifiers",
].join(",");

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function mapProductDetailsInBatches<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += PRODUCT_DETAIL_CONCURRENCY) {
    results.push(
      ...await Promise.all(
        items
          .slice(index, index + PRODUCT_DETAIL_CONCURRENCY)
          .map(mapper),
      ),
    );
  }
  return results;
}

type ConnectedEnvironment = BigCommerceEnvironmentConnection & {
  accessToken: string;
};

class CatalogRequestError extends Error {}

export type ChannelCatalog = {
  environment: {
    id: number;
    name: string;
    storeHash: string;
  };
  channel: {
    id: number;
    name: string;
    platform: string;
    type: string;
  } | null;
  categories: CatalogCategory[];
  products: CatalogProduct[];
  currency: string;
  locales: CatalogLocale[];
  activeLocale: string | null;
  categoriesError: string | null;
  productsError: string | null;
  error: string | null;
};

function getApiErrorMessage(status: number, fallback: string) {
  if (status === 401) {
    return "Check the saved access token.";
  }

  if (status === 403) {
    return "The token is missing the required catalog read scope.";
  }

  if (status === 429) {
    return "BigCommerce rate limit reached. Try again shortly.";
  }

  return fallback;
}

function getRequestErrorMessage(error: unknown) {
  return error instanceof CatalogRequestError
    ? error.message
    : error instanceof Error && error.name === "TimeoutError"
      ? "BigCommerce took too long to respond."
      : "Unable to reach BigCommerce.";
}

async function fetchBigCommerce(
  environment: ConnectedEnvironment,
  path: string,
) {
  for (let attempt = 0; attempt <= READ_RATE_LIMIT_RETRIES; attempt += 1) {
    const response = await fetch(
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
    if (response.status !== 429 || attempt === READ_RATE_LIMIT_RETRIES) {
      return response;
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 15_000)
      : Math.min(1000 * 2 ** attempt, 12_000);
    await wait(delay);
  }
  throw new CatalogRequestError("BigCommerce rate limit persisted.");
}

async function fetchBigCommerceCollection(
  environment: ConnectedEnvironment,
  path: string,
  resource: string,
) {
  const entries: unknown[] = [];
  let page = 1;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await fetchBigCommerce(
      environment,
      `${path}${separator}limit=${PRODUCT_PAGE_SIZE}&page=${page}`,
    );
    if (!response.ok) {
      throw new CatalogRequestError(
        getApiErrorMessage(
          response.status,
          `BigCommerce did not return ${resource}.`,
        ),
      );
    }

    const payload: unknown = await response.json();
    const data =
      typeof payload === "object" && payload !== null && "data" in payload
        ? (payload as { data?: unknown }).data
        : null;
    if (!Array.isArray(data)) {
      throw new CatalogRequestError(
        `BigCommerce returned an unexpected ${resource} response.`,
      );
    }

    entries.push(...data);
    if (page >= readPaginationTotalPages(payload)) break;
    page += 1;
  }

  return entries;
}

async function fetchBigCommerceGraphql(
  environment: ConnectedEnvironment,
  query: string,
  variables: Record<string, unknown>,
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
  const errors =
    typeof payload === "object" && payload !== null && "errors" in payload
      ? payload.errors
      : null;
  if (!response.ok || (Array.isArray(errors) && errors.length > 0)) {
    throw new CatalogRequestError("BigCommerce did not return catalog localization data.");
  }
  return payload;
}

async function loadTranslationCollection(
  environment: ConnectedEnvironment,
  channelId: number,
  localeCode: string,
  resourceType: "PRODUCTS" | "CATEGORIES",
) {
  const edges: unknown[] = [];
  let after: string | null = null;
  while (true) {
    const payload = await fetchBigCommerceGraphql(
      environment,
      `query CatalogTranslations($channelId: ID!, $localeId: ID!, $after: String) { store { translations(filters: { resourceType: ${resourceType}, channelId: $channelId, localeId: $localeId } first: 50 after: $after) { edges { node { resourceId fields { fieldName original translation } } cursor } pageInfo { hasNextPage endCursor } } } }`,
      {
        channelId: `bc/store/channel/${channelId}`,
        localeId: `bc/store/locale/${localeCode}`,
        after,
      },
    );
    const root = payload as { data?: { store?: { translations?: {
      edges?: unknown[];
      pageInfo?: { hasNextPage?: boolean; endCursor?: string };
    } } } };
    const translations = root.data?.store?.translations;
    if (Array.isArray(translations?.edges)) edges.push(...translations.edges);
    if (!translations?.pageInfo?.hasNextPage || !translations.pageInfo.endCursor) break;
    after = translations.pageInfo.endCursor;
  }
  return { edges };
}

async function loadChannelLocalization(
  environment: ConnectedEnvironment,
  channelId: number,
  requestedLocale?: string | null,
) {
  const payload = await fetchBigCommerceGraphql(
    environment,
    `query ChannelLocales($channelId: ID!) { store { locales(input: { channelId: $channelId }) { edges { node { code status isDefault } } } } }`,
    { channelId: `bc/store/channel/${channelId}` },
  );
  const locales = parseCatalogLocales(payload);
  const activeLocale = selectCatalogLocale(locales, requestedLocale);
  if (!activeLocale || locales.length < 2) {
    return { locales, activeLocale: activeLocale?.code ?? null, categoryTranslations: new Map(), productTranslations: new Map() };
  }
  const [products, categories] = await Promise.all([
    loadTranslationCollection(environment, channelId, activeLocale.code, "PRODUCTS"),
    loadTranslationCollection(environment, channelId, activeLocale.code, "CATEGORIES"),
  ]);
  return {
    locales,
    activeLocale: activeLocale.code,
    categoryTranslations: parseCatalogTranslations(categories),
    productTranslations: parseCatalogTranslations(products),
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readPositiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
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

  if (text.length <= 150) {
    return text;
  }

  return `${text.slice(0, 147).trimEnd()}…`;
}

function readImageUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" || !CDN_HOST_PATTERN.test(url.hostname)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function readPaginationTotalPages(payload: unknown) {
  const value =
    typeof payload === "object" && payload !== null && "meta" in payload
      ? (payload as {
          meta?: { pagination?: { total_pages?: unknown } };
        }).meta?.pagination?.total_pages
      : undefined;

  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 1;
}

function parseCategory(value: unknown, depth = 0): CatalogCategory | null {
  if (typeof value !== "object" || value === null || depth > MAX_CATEGORY_DEPTH) {
    return null;
  }

  const id = "id" in value ? readPositiveInteger(value.id) : null;
  const name = "name" in value ? readString(value.name) : "";

  if (!id || !name) {
    return null;
  }

  const rawChildren =
    "children" in value && Array.isArray(value.children) ? value.children : [];
  const children = rawChildren.flatMap((child) => {
    const category = parseCategory(child, depth + 1);
    return category ? [category] : [];
  });

  return { id, name, children };
}

async function loadChannel(
  environment: ConnectedEnvironment,
  channelId: number,
) {
  const response = await fetchBigCommerce(
    environment,
    `/v3/channels/${channelId}`,
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new CatalogRequestError(
      getApiErrorMessage(
        response.status,
        "BigCommerce did not return this channel.",
      ),
    );
  }

  const payload: unknown = await response.json();
  const data =
    typeof payload === "object" && payload !== null && "data" in payload
      ? (payload as { data?: unknown }).data
      : null;

  if (typeof data !== "object" || data === null) {
    throw new CatalogRequestError("BigCommerce returned an unexpected channel.");
  }

  const id = "id" in data ? readPositiveInteger(data.id) : null;
  const name = "name" in data ? readString(data.name) : "";
  const status = "status" in data ? readString(data.status) : "";

  if (!id || !name || status.toLowerCase() === "deleted") {
    return null;
  }

  return {
    id,
    name,
    platform: "platform" in data ? readString(data.platform) : "",
    type: "type" in data ? readString(data.type) : "",
  };
}

async function loadCategories(
  environment: ConnectedEnvironment,
  channelId: number,
) {
  const treesResponse = await fetchBigCommerce(
    environment,
    "/v3/catalog/trees?limit=250",
  );

  if (!treesResponse.ok) {
    throw new CatalogRequestError(
      getApiErrorMessage(
        treesResponse.status,
        "BigCommerce did not return the category trees.",
      ),
    );
  }

  const treesPayload: unknown = await treesResponse.json();
  const trees =
    typeof treesPayload === "object" &&
    treesPayload !== null &&
    "data" in treesPayload &&
    Array.isArray(treesPayload.data)
      ? treesPayload.data
      : null;

  if (!trees) {
    throw new CatalogRequestError(
      "BigCommerce returned an unexpected category-tree response.",
    );
  }

  const tree = trees.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "channels" in entry &&
      Array.isArray(entry.channels) &&
      entry.channels.some((id: unknown) => Number(id) === channelId),
  );
  const treeId =
    typeof tree === "object" && tree !== null && "id" in tree
      ? readPositiveInteger(tree.id)
      : null;

  if (!treeId) {
    return [];
  }

  const categoriesResponse = await fetchBigCommerce(
    environment,
    `/v3/catalog/trees/${treeId}/categories`,
  );

  if (!categoriesResponse.ok) {
    throw new CatalogRequestError(
      getApiErrorMessage(
        categoriesResponse.status,
        "BigCommerce did not return this channel's categories.",
      ),
    );
  }

  const categoriesPayload: unknown = await categoriesResponse.json();
  const data =
    typeof categoriesPayload === "object" &&
    categoriesPayload !== null &&
    "data" in categoriesPayload &&
    Array.isArray(categoriesPayload.data)
      ? categoriesPayload.data
      : null;

  if (!data) {
    throw new CatalogRequestError(
      "BigCommerce returned an unexpected category response.",
    );
  }

  return data.flatMap((entry) => {
    const category = parseCategory(entry);
    return category ? [category] : [];
  });
}

async function loadProducts(
  environment: ConnectedEnvironment,
  channelId: number,
) {
  // The products `channel_id` filter is not consistently enforced by every
  // BigCommerce catalog response. Product channel assignments are the
  // authoritative relationship, so resolve those IDs first and only then
  // request product records.
  const assignedProductIds: number[] = [];
  let assignmentPage = 1;

  while (true) {
    const assignmentsResponse = await fetchBigCommerce(
      environment,
      `/v3/catalog/products/channel-assignments?channel_id:in=${channelId}&limit=${PRODUCT_PAGE_SIZE}&page=${assignmentPage}`,
    );

    if (!assignmentsResponse.ok) {
      throw new CatalogRequestError(
        getApiErrorMessage(
          assignmentsResponse.status,
          "BigCommerce did not return this channel's product assignments.",
        ),
      );
    }

    const assignmentsPayload: unknown = await assignmentsResponse.json();
    const assignments =
      typeof assignmentsPayload === "object" &&
      assignmentsPayload !== null &&
      "data" in assignmentsPayload &&
      Array.isArray(assignmentsPayload.data)
        ? assignmentsPayload.data
        : null;

    if (!assignments) {
      throw new CatalogRequestError(
        "BigCommerce returned an unexpected product-assignment response.",
      );
    }

    assignedProductIds.push(
      ...assignments.flatMap((assignment: unknown) => {
        if (typeof assignment !== "object" || assignment === null) {
          return [];
        }

        const productId =
          "product_id" in assignment
            ? readPositiveInteger(assignment.product_id)
            : null;
        return productId ? [productId] : [];
      }),
    );

    if (assignmentPage >= readPaginationTotalPages(assignmentsPayload)) {
      break;
    }

    assignmentPage += 1;
  }

  const uniqueProductIds = [...new Set(assignedProductIds)];
  if (uniqueProductIds.length === 0) {
    return [];
  }

  const products: CatalogProduct[] = [];
  for (let offset = 0; offset < uniqueProductIds.length; offset += PRODUCT_PAGE_SIZE) {
    const productIds = uniqueProductIds.slice(offset, offset + PRODUCT_PAGE_SIZE);
    const response = await fetchBigCommerce(
      environment,
      `/v3/catalog/products?id:in=${productIds.join(",")}&limit=${PRODUCT_PAGE_SIZE}&include=primary_image&include_fields=id,name,description,price,calculated_price,primary_image,is_visible,categories`,
    );

    if (!response.ok) {
      throw new CatalogRequestError(
        getApiErrorMessage(
          response.status,
          "BigCommerce did not return this channel's products.",
        ),
      );
    }

    const payload: unknown = await response.json();
    const data =
      typeof payload === "object" && payload !== null && "data" in payload
        ? (payload as { data?: unknown }).data
        : null;

    if (!Array.isArray(data)) {
      throw new CatalogRequestError(
        "BigCommerce returned an unexpected product response.",
      );
    }

    products.push(
      ...data.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) {
          return [];
        }

        const id = "id" in entry ? readPositiveInteger(entry.id) : null;
        const name = "name" in entry ? readString(entry.name) : "";

        if (!id || !name) {
          return [];
        }

        const calculatedPrice =
          "calculated_price" in entry ? Number(entry.calculated_price) : NaN;
        const basePrice = "price" in entry ? Number(entry.price) : NaN;
        const image =
          "primary_image" in entry &&
          typeof entry.primary_image === "object" &&
          entry.primary_image !== null &&
          "url_standard" in entry.primary_image
            ? entry.primary_image.url_standard
            : null;
        const categoryIds =
          "categories" in entry && Array.isArray(entry.categories)
            ? entry.categories.flatMap((categoryId: unknown) => {
                const parsedId = readPositiveInteger(categoryId);
                return parsedId ? [parsedId] : [];
              })
            : [];

        return [
          {
            id,
            name,
            description:
              "description" in entry
                ? toShortDescription(entry.description)
                : "",
            price: Number.isFinite(calculatedPrice)
              ? calculatedPrice
              : Number.isFinite(basePrice)
                ? basePrice
                : null,
            imageUrl: readImageUrl(image),
            categoryIds,
          },
        ];
      }),
    );

  }

  return products;
}

async function loadCurrency(environment: ConnectedEnvironment) {
  try {
    const response = await fetchBigCommerce(environment, "/v2/store");

    if (!response.ok) {
      return DEFAULT_CURRENCY;
    }

    const payload: unknown = await response.json();
    const currency =
      typeof payload === "object" && payload !== null && "currency" in payload
        ? readString(payload.currency).toUpperCase()
        : "";

    return /^[A-Z]{3}$/.test(currency) ? currency : DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

async function capture<T>(promise: Promise<T>) {
  try {
    return { data: await promise, error: null };
  } catch (error) {
    return { data: null, error: getRequestErrorMessage(error) };
  }
}

export async function getChannelCatalog(
  environmentId: number,
  channelId: number,
  requestedLocale?: string | null,
): Promise<ChannelCatalog | null> {
  const user = await requireAppUser();
  const environment = await getBigCommerceEnvironmentConnection(
    user.id,
    environmentId,
  );

  if (!environment) {
    return null;
  }

  const safeEnvironment = {
    id: environment.id,
    name: environment.name,
    storeHash: environment.storeHash,
  };

  if (!environment.accessToken) {
    return {
      environment: safeEnvironment,
      channel: null,
      categories: [],
      products: [],
      currency: DEFAULT_CURRENCY,
      locales: [],
      activeLocale: null,
      categoriesError: null,
      productsError: null,
      error: "The saved token could not be decrypted. Re-save it in Settings.",
    };
  }

  const connectedEnvironment = {
    ...environment,
    accessToken: environment.accessToken,
  };
  let channel: Awaited<ReturnType<typeof loadChannel>>;

  try {
    channel = await loadChannel(connectedEnvironment, channelId);
  } catch (error) {
    return {
      environment: safeEnvironment,
      channel: null,
      categories: [],
      products: [],
      currency: DEFAULT_CURRENCY,
      locales: [],
      activeLocale: null,
      categoriesError: null,
      productsError: null,
      error: getRequestErrorMessage(error),
    };
  }

  if (!channel) {
    return null;
  }

  const [categoriesResult, productsResult, currency, localizationResult] = await Promise.all([
    capture(loadCategories(connectedEnvironment, channelId)),
    capture(loadProducts(connectedEnvironment, channelId)),
    loadCurrency(connectedEnvironment),
    capture(loadChannelLocalization(connectedEnvironment, channelId, requestedLocale)),
  ]);

  const localization = localizationResult.data;
  const localized = applyCatalogTranslations(
    categoriesResult.data ?? [],
    productsResult.data ?? [],
    localization?.categoryTranslations ?? new Map(),
    localization?.productTranslations ?? new Map(),
  );

  return {
    environment: safeEnvironment,
    channel,
    categories: localized.categories,
    products: localized.products,
    currency,
    locales: localization?.locales ?? [],
    activeLocale: localization?.activeLocale ?? null,
    categoriesError: categoriesResult.error,
    productsError: productsResult.error,
    error: null,
  };
}

export async function getChannelProductDetails(
  environmentId: number,
  channelId: number,
  productId: number,
): Promise<ProductDetailRecord | null> {
  const user = await requireAppUser();
  const environment = await getBigCommerceEnvironmentConnection(
    user.id,
    environmentId,
  );
  if (!environment?.accessToken) return null;

  const connectedEnvironment = {
    ...environment,
    accessToken: environment.accessToken,
  };
  const channel = await loadChannel(connectedEnvironment, channelId);
  if (!channel) return null;

  const assignments = await fetchBigCommerceCollection(
    connectedEnvironment,
    `/v3/catalog/products/channel-assignments?channel_id:in=${channelId}&product_id:in=${productId}`,
    "product channel assignments",
  );
  const assigned = assignments.some((assignment) =>
    typeof assignment === "object" &&
    assignment !== null &&
    "product_id" in assignment &&
    Number(assignment.product_id) === productId
  );
  if (!assigned) return null;

  const productResponse = await fetchBigCommerce(
    connectedEnvironment,
    `/v3/catalog/products/${productId}?include=${PRODUCT_DETAIL_INCLUDES}`,
  );
  if (productResponse.status === 404) return null;
  if (!productResponse.ok) {
    throw new CatalogRequestError(
      getApiErrorMessage(
        productResponse.status,
        "BigCommerce did not return the requested product.",
      ),
    );
  }

  const productPayload: unknown = await productResponse.json();
  const product =
    typeof productPayload === "object" &&
    productPayload !== null &&
    "data" in productPayload &&
    typeof productPayload.data === "object" &&
    productPayload.data !== null &&
    !Array.isArray(productPayload.data)
      ? productPayload.data as Record<string, unknown>
      : null;
  if (!product) {
    throw new CatalogRequestError(
      "BigCommerce returned an unexpected product detail response.",
    );
  }

  const variants = Array.isArray(product.variants)
    ? product.variants.flatMap((variant) => {
        if (typeof variant !== "object" || variant === null) return [];
        const variantId = "id" in variant ? readPositiveInteger(variant.id) : null;
        return variantId ? [{ variantId }] : [];
      })
    : [];
  const [metafields, variantMetafields] = await Promise.all([
    fetchBigCommerceCollection(
      connectedEnvironment,
      `/v3/catalog/products/${productId}/metafields`,
      `metafields for product ${productId}`,
    ),
    mapProductDetailsInBatches(variants, async ({ variantId }) => ({
      variantId,
      data: await fetchBigCommerceCollection(
        connectedEnvironment,
        `/v3/catalog/products/${productId}/variants/${variantId}/metafields`,
        `metafields for variant ${variantId}`,
      ),
    })),
  ]);

  return { data: product, metafields, variantMetafields };
}
