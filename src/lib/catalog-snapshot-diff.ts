import "server-only";

import { SNAPSHOT_RESTORE_GROUPS } from "@/lib/snapshot-configuration";

type JsonRecord = Record<string, unknown>;

export type SnapshotDiffChangeKind = "added" | "removed" | "changed";

export type SnapshotDiffEntry = {
  key: string;
  label: string;
  change: SnapshotDiffChangeKind;
  fields: string[];
};

export type SnapshotDiffSection = {
  id: "categories" | "products" | "variants" | "images" | "metafields" | "configuration";
  label: string;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  entries: SnapshotDiffEntry[];
  omittedEntries: number;
};

export type CatalogSnapshotDiff = {
  from: { id: number; version: number; createdAt: string };
  to: { id: number; version: number; createdAt: string };
  sections: SnapshotDiffSection[];
  hasChanges: boolean;
};

const MAX_ENTRIES_PER_SECTION = 120;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: unknown) {
  return readText(value).toLocaleLowerCase();
}

function readNumber(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function dataArray(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((entry) => (asRecord(entry) ? [asRecord(entry)!] : []))
    : [];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, stableValue(record[key])]),
  );
}

function serialized(value: unknown) {
  return JSON.stringify(stableValue(value));
}

function changedFields(before: JsonRecord, after: JsonRecord, ignored: string[] = []) {
  const ignoredKeys = new Set(ignored);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !ignoredKeys.has(key) && serialized(before[key]) !== serialized(after[key]))
    .sort();
}

type Comparable = {
  key: string;
  label: string;
  value: JsonRecord;
  ignoredFields?: string[];
};

function compareRecords(
  id: SnapshotDiffSection["id"],
  label: string,
  beforeRecords: Comparable[],
  afterRecords: Comparable[],
): SnapshotDiffSection {
  const before = new Map(beforeRecords.map((record) => [record.key, record]));
  const after = new Map(afterRecords.map((record) => [record.key, record]));
  const entries: SnapshotDiffEntry[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const previous = before.get(key);
    const next = after.get(key);
    if (!previous && next) {
      added += 1;
      entries.push({ key, label: next.label, change: "added", fields: [] });
      continue;
    }
    if (previous && !next) {
      removed += 1;
      entries.push({ key, label: previous.label, change: "removed", fields: [] });
      continue;
    }
    if (!previous || !next) continue;
    const fields = changedFields(
      previous.value,
      next.value,
      [...(previous.ignoredFields ?? []), ...(next.ignoredFields ?? [])],
    );
    if (fields.length > 0) {
      changed += 1;
      entries.push({ key, label: next.label, change: "changed", fields });
    } else {
      unchanged += 1;
    }
  }

  return {
    id,
    label,
    added,
    removed,
    changed,
    unchanged,
    entries: entries.slice(0, MAX_ENTRIES_PER_SECTION),
    omittedEntries: Math.max(0, entries.length - MAX_ENTRIES_PER_SECTION),
  };
}

function catalog(manifest: JsonRecord) {
  return asRecord(manifest.catalog) ?? {};
}

function categoryRecords(manifest: JsonRecord) {
  const categories = dataArray(catalog(manifest).categories).flatMap((entry) => {
    const data = asRecord(entry.data);
    return data ? [{ wrapper: entry, data }] : [];
  });
  const byId = new Map(
    categories.flatMap(({ data }) => {
      const id = readNumber(data.category_id ?? data.id);
      return id === null ? [] : [[id, data] as const];
    }),
  );
  const pathCache = new Map<number, string>();

  function pathFor(data: JsonRecord, visited = new Set<number>()): string {
    const id = readNumber(data.category_id ?? data.id);
    if (id !== null && pathCache.has(id)) return pathCache.get(id)!;
    const name = readText(data.name) || `Category ${id ?? "unknown"}`;
    const slug = readText(asRecord(data.custom_url)?.url) || normalize(name);
    const parentId = readNumber(data.parent_id);
    if (id !== null && visited.has(id)) return slug;
    const parent = parentId && parentId !== id ? byId.get(parentId) : null;
    const path = parent
      ? `${pathFor(parent, new Set(visited).add(id ?? -1))}/${slug.replace(/^\/+|\/+$/g, "")}`
      : slug;
    if (id !== null) pathCache.set(id, path);
    return path;
  }

  return categories.map(({ wrapper, data }) => ({
    wrapper,
    data,
    key: `category:${normalize(pathFor(data))}`,
    label: readText(data.name) || "Unnamed category",
  }));
}

function productRecords(manifest: JsonRecord) {
  return dataArray(catalog(manifest).products).flatMap((entry) => {
    const data = asRecord(entry.data);
    if (!data) return [];
    const sku = normalize(data.sku);
    const slug = normalize(asRecord(data.custom_url)?.url);
    const name = readText(data.name) || "Unnamed product";
    const id = readNumber(data.id);
    return [{
      wrapper: entry,
      data,
      key: `product:${sku ? `sku:${sku}` : slug ? `slug:${slug}` : `name:${normalize(name)}:${id ?? ""}`}`,
      label: name,
    }];
  });
}

const PRODUCT_CHILD_FIELDS = [
  "variants",
  "images",
  "custom_fields",
  "bulk_pricing_rules",
  "videos",
  "options",
  "modifiers",
];

function products(manifest: JsonRecord): Comparable[] {
  return productRecords(manifest).map(({ key, label, data }) => ({
    key,
    label,
    value: data,
    ignoredFields: PRODUCT_CHILD_FIELDS,
  }));
}

function variants(manifest: JsonRecord): Comparable[] {
  return productRecords(manifest).flatMap((product) =>
    dataArray(product.data.variants).map((variant) => {
      const sku = normalize(variant.sku);
      const options = dataArray(variant.option_values)
        .map((option) => `${normalize(option.option_display_name ?? option.option_id)}=${normalize(option.label ?? option.option_value)}`)
        .sort()
        .join("|");
      const id = readNumber(variant.id);
      const variantName = readText(variant.sku) || options || `Variant ${id ?? "unknown"}`;
      return {
        key: `${product.key}/variant:${sku ? `sku:${sku}` : options ? `options:${options}` : `id:${id ?? "unknown"}`}`,
        label: `${product.label} · ${variantName}`,
        value: variant,
      };
    }),
  );
}

function images(manifest: JsonRecord): Comparable[] {
  return productRecords(manifest).flatMap((product) =>
    dataArray(product.data.images).map((image) => {
      const url = normalize(image.url_standard ?? image.image_url ?? image.url_zoom ?? image.url_thumbnail);
      const id = readNumber(image.id);
      const description = readText(image.description) || `Image ${id ?? "unknown"}`;
      return {
        key: `${product.key}/image:${url || `${normalize(description)}:${id ?? ""}`}`,
        label: `${product.label} · ${description}`,
        value: image,
      };
    }),
  );
}

function metafieldKey(value: JsonRecord, fallback: string) {
  const namespace = normalize(value.namespace);
  const key = normalize(value.key);
  return namespace || key ? `${namespace}:${key}` : `id:${readNumber(value.id) ?? fallback}`;
}

function metafields(manifest: JsonRecord): Comparable[] {
  const categoryFields = categoryRecords(manifest).flatMap((category) =>
    dataArray(category.wrapper.metafields).map((metafield, index) => ({
      key: `${category.key}/metafield:${metafieldKey(metafield, String(index))}`,
      label: `${category.label} · ${readText(metafield.namespace)}:${readText(metafield.key)}`,
      value: metafield,
    })),
  );
  const productFields = productRecords(manifest).flatMap((product) => {
    const direct = dataArray(product.wrapper.metafields).map((metafield, index) => ({
      key: `${product.key}/metafield:${metafieldKey(metafield, String(index))}`,
      label: `${product.label} · ${readText(metafield.namespace)}:${readText(metafield.key)}`,
      value: metafield,
    }));
    const variantsById = new Map(
      dataArray(product.data.variants).flatMap((variant) => {
        const id = readNumber(variant.id);
        return id === null ? [] : [[id, variant] as const];
      }),
    );
    const variantFields = dataArray(product.wrapper.variantMetafields).flatMap((entry) => {
      const sourceVariantId = readNumber(entry.variantId);
      const variant = sourceVariantId === null ? null : variantsById.get(sourceVariantId);
      const sku = normalize(variant?.sku);
      const ownerKey = sku ? `sku:${sku}` : `id:${sourceVariantId ?? "unknown"}`;
      const ownerLabel = readText(variant?.sku) || `Variant ${sourceVariantId ?? "unknown"}`;
      return dataArray(entry.data).map((metafield, index) => ({
        key: `${product.key}/variant:${ownerKey}/metafield:${metafieldKey(metafield, String(index))}`,
        label: `${product.label} · ${ownerLabel} · ${readText(metafield.namespace)}:${readText(metafield.key)}`,
        value: metafield,
      }));
    });
    return [...direct, ...variantFields];
  });
  return [...categoryFields, ...productFields];
}

function configuration(manifest: JsonRecord): Comparable[] {
  const captured = asRecord(manifest.configuration) ?? {};
  return SNAPSHOT_RESTORE_GROUPS.flatMap((group) => {
    if (group.id === "catalog") return [];
    const resources = asRecord(asRecord(captured[group.id])?.resources) ?? {};
    return Object.entries(resources).flatMap(([resourceKey, resourceValue]) => {
      const resource = asRecord(resourceValue);
      if (!resource) return [];
      return [{
        key: `${group.id}:${resourceKey}`,
        label: `${group.label} · ${readText(resource.label) || resourceKey}`,
        value: resource,
      }];
    });
  });
}

export function diffCatalogSnapshotManifests(input: {
  from: { id: number; version: number; createdAt: string; manifest: JsonRecord };
  to: { id: number; version: number; createdAt: string; manifest: JsonRecord };
}): CatalogSnapshotDiff {
  const sections = [
    compareRecords("categories", "Categories", categoryRecords(input.from.manifest).map(({ key, label, data }) => ({ key, label, value: data })), categoryRecords(input.to.manifest).map(({ key, label, data }) => ({ key, label, value: data }))),
    compareRecords("products", "Products", products(input.from.manifest), products(input.to.manifest)),
    compareRecords("variants", "Variants", variants(input.from.manifest), variants(input.to.manifest)),
    compareRecords("images", "Images", images(input.from.manifest), images(input.to.manifest)),
    compareRecords("metafields", "Metafields", metafields(input.from.manifest), metafields(input.to.manifest)),
    compareRecords("configuration", "Configuration", configuration(input.from.manifest), configuration(input.to.manifest)),
  ];
  return {
    from: { id: input.from.id, version: input.from.version, createdAt: input.from.createdAt },
    to: { id: input.to.id, version: input.to.version, createdAt: input.to.createdAt },
    sections,
    hasChanges: sections.some((section) => section.added + section.removed + section.changed > 0),
  };
}
