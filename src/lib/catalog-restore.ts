import "server-only";

import { requireAppUser } from "@/lib/auth";
import {
  getBigCommerceEnvironmentConnection,
  getBigCommerceEnvironmentConnections,
  getAccessibleCatalogSnapshot,
  type BigCommerceEnvironmentConnection,
  type CatalogSnapshotRecord,
} from "@/lib/db";
import type { CatalogSnapshotManifestV1 } from "@/lib/catalog-snapshots";
import {
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
  channels: Array<{ id: number; name: string }>;
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
  restoredGroups: SnapshotRestoreGroup[];
  destinationEnvironmentName: string;
  destinationChannelName: string;
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

function extractApiMessage(payload: unknown) {
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
    throw new CatalogRestoreError(`BigCommerce rejected ${resource}.`);
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
  "name", "type", "enabled", "handling_fees", "is_fallback", "settings",
] as const;

async function reconcileShippingConfiguration(
  environment: ConnectedEnvironment,
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
    const target = targetZones.find(
      (candidate) => normalizeText(candidate.name) === normalizeText(name),
    );
    let targetId = readPositiveInteger(target?.id);
    await bestEffort(`Shipping zone ${name}`, async () => {
      const payload = await apiRequestV2(
        environment,
        targetId ? `/shipping/zones/${targetId}` : "/shipping/zones",
        {
          method: targetId ? "PUT" : "POST",
          body: pick(source!, SHIPPING_ZONE_FIELDS),
          resource: `shipping zone ${name}`,
        },
      );
      targetId ??= readPositiveInteger(asRecord(payload)?.id);
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
        await apiRequestV2(
          environment,
          targetMethodId
            ? `/shipping/zones/${targetId}/methods/${targetMethodId}`
            : `/shipping/zones/${targetId}/methods`,
          {
            method: targetMethodId ? "PUT" : "POST",
            body: pick(method, SHIPPING_METHOD_FIELDS),
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
    const target = sourceId === 1
      ? targetZones.find((zone) => Number(zone.id) === 1)
      : targetZones.find((zone) => normalizeText(zone.name) === normalizeText(name));
    let targetId = readPositiveInteger(target?.id);
    await bestEffort(`Tax zone ${name}`, async () => {
      const body = { ...source };
      delete body.id;
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

async function listChannels(environment: ConnectedEnvironment) {
  const channels = await fetchCollection(environment, "/channels", "channels");

  return channels.flatMap((value) => {
    const channel = asRecord(value);
    const id = readPositiveInteger(channel?.id);
    const name = readString(channel?.name);

    return id && name && normalizeText(channel?.type) === "storefront" && ["active", "prelaunch"].includes(normalizeText(channel?.status))
      ? [{ id, name }]
      : [];
  });
}

export async function getCatalogRestoreDestinations(): Promise<
  CatalogRestoreDestination[]
> {
  const user = await requireAppUser();
  const environments = await getBigCommerceEnvironmentConnections(user.id);
  const destinations: CatalogRestoreDestination[] = [];

  for (const environment of environments) {
    if (!environment.accessToken) {
      destinations.push({
        id: environment.id,
        name: environment.name,
        storeHash: environment.storeHash,
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
        channels: await listChannels({ ...environment, accessToken: environment.accessToken }),
        error: null,
      });
    } catch (error) {
      destinations.push({
        id: environment.id,
        name: environment.name,
        storeHash: environment.storeHash,
        channels: [],
        error:
          error instanceof CatalogRestoreError
            ? error.message.replace(/ The restore may be partially complete\.$/, "")
            : "Unable to load channels.",
      });
    }
  }

  return destinations;
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

async function restoreConfiguration(
  environment: ConnectedEnvironment,
  destinationChannelId: number,
  manifest: CatalogSnapshotManifestV1,
  groups: SnapshotRestoreGroup[],
  warnings: string[],
  sourceToTargetProduct: Map<number, number>,
  onProgress?: (currentStep: string, stepIndex?: number, totalSteps?: number) => Promise<void>,
) {
  const configuration = manifest.configuration;
  const selected = groups.filter(
    (group): group is Exclude<SnapshotRestoreGroup, "catalog"> => group !== "catalog",
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
    for (const resource of Object.values(resources)) {
      if (resource.warning) warnings.push(`${resource.label}: ${resource.warning}`);
    }

    if (group === "channel") {
      const metafields = capturedData(resources.channelMetafields);
      if (Array.isArray(metafields)) {
        await bestEffort("Channel metafields", () =>
          syncMetafields(
            environment,
            `/channels/${destinationChannelId}/metafields`,
            metafields,
            "channel metafields",
          ),
        );
      }
      const sourceChannel = manifest.catalog.channel;
      const channelPatch = pick(sourceChannel, ["is_visible"]);
      if (Object.keys(channelPatch).length > 0) {
        await bestEffort("Channel properties", () =>
          apiRequest(environment, `/channels/${destinationChannelId}`, {
            method: "PUT",
            body: channelPatch,
            resource: "channel properties",
          }),
        );
      }
      const sourceRoutes = capturedData(resources.siteRoutes);
      if (Array.isArray(sourceRoutes) && sourceRoutes.length > 0) {
        await bestEffort("Site routes", async () => {
          const destinationSitePayload = await apiRequest(
            environment,
            `/channels/${destinationChannelId}/site`,
            { resource: "destination channel site" },
          );
          const destinationSiteId = readPositiveInteger(
            asRecord(asRecord(destinationSitePayload)?.data)?.id,
          );
          if (!destinationSiteId) {
            throw new CatalogRestoreError("The destination channel has no site for route restoration.");
          }
          const routes = sourceRoutes.flatMap((value) => {
            const route = writableObject(value);
            if (!route) return [];
            delete route.url;
            return [{ ...route, site_id: destinationSiteId }];
          });
          if (routes.length > 0) {
            await apiRequest(environment, `/sites/${destinationSiteId}/routes`, {
              method: "PUT",
              body: routes,
              resource: "site routes",
            });
          }
        });
      }
      if (capturedData(resources.site)) {
        warnings.push("The source site, domain, and checkout URL were captured for reference but were not copied; destination DNS and SSL ownership remain unchanged.");
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
      const currencies = writableObject(capturedData(resources.currencyAssignments));
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
      if (capturedData(resources.priceListRecords)) {
        warnings.push("Price-list records were captured, but records whose variant IDs differ in the destination were not copied. Price-list definitions and channel assignments were restored by name.");
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
      await reconcileShippingConfiguration(environment, resources, bestEffort);
      continue;
    }

    if (group === "tax") {
      const zoneMap = await reconcileTaxConfiguration(environment, resources, bestEffort);
      const settings = writableObject(capturedData(resources.taxSettings));
      if (settings) {
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
      if (storeLocale) {
        await bestEffort("Store locale settings", () =>
          apiRequest(environment, "/settings/store/locale", {
            method: "PUT",
            body: storeLocale,
            resource: "store locale settings",
          }),
        );
      }
      const localePayload = asRecord(capturedData(resources.channelLocales));
      const localeEdges = asRecord(asRecord(asRecord(localePayload?.data)?.store)?.locales)?.edges;
      if (Array.isArray(localeEdges)) {
        for (const edge of localeEdges) {
          const locale = asRecord(asRecord(edge)?.node);
          const code = readString(locale?.code);
          const status = readString(locale?.status);
          if (!code || !status) continue;
          const normalizedStatus = status.toUpperCase() === "ACTIVE" ? "ACTIVE" : "INACTIVE";
          await bestEffort(`Locale ${code}`, async () => {
            const variables = {
              channelId: `bc/store/channel/${destinationChannelId}`,
              code,
            };
            try {
              await graphqlRequest(environment, `mutation RestoreLocale($channelId: ID!, $code: String!) { locale { updateLocale(input: { channelId: $channelId, code: $code, status: ${normalizedStatus}, isDefault: ${Boolean(locale?.isDefault)} }) { locale { code } errors { ... on Error { message } } } } }`, variables, `locale ${code}`);
            } catch {
              await graphqlRequest(environment, `mutation AddLocale($channelId: ID!, $code: String!) { locale { addLocale(input: { channelId: $channelId, code: $code, status: ${normalizedStatus} }) { locale { code } errors { ... on Error { message } } } } }`, variables, `locale ${code}`);
              if (Boolean(locale?.isDefault)) {
                await graphqlRequest(environment, `mutation MakeLocaleDefault($channelId: ID!, $code: String!) { locale { updateLocale(input: { channelId: $channelId, code: $code, status: ${normalizedStatus}, isDefault: true }) { locale { code } errors { ... on Error { message } } } } }`, variables, `locale ${code}`);
              }
            }
          });
        }
      }
      if (capturedData(resources.productTranslations) || capturedData(resources.categoryTranslations)) {
        warnings.push("Catalog translations were captured for audit, but were not applied because translated resource IDs must be remapped after catalog reconciliation.");
      }
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
    await rebuildVariants(environment, productId, target, sourceRecord);

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
    if (!targetId || !Array.isArray(sourceRecord.data.related_products)) continue;

    const relatedProducts = sourceRecord.data.related_products.flatMap((value) => {
      const relatedSourceId = readPositiveInteger(value);
      const relatedTargetId = relatedSourceId
        ? sourceToTargetProduct.get(relatedSourceId)
        : undefined;
      return relatedTargetId ? [relatedTargetId] : [];
    });

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
  const restoreGroups = parseSnapshotRestoreGroups(
    input.restoreGroups?.length ? input.restoreGroups : ["catalog"],
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
  await restoreConfiguration(
    environment,
    input.destinationChannelId,
    manifest,
    restoreGroups,
    productState.warnings,
    productState.sourceToTargetProduct,
    input.onProgress,
  );
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
