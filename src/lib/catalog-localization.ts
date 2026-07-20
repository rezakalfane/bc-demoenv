import type { CatalogCategory, CatalogProduct } from "@/lib/catalog-types";

type JsonRecord = Record<string, unknown>;

export type CatalogLocale = {
  code: string;
  isDefault: boolean;
  status: string;
};

export type CatalogTranslationFields = Map<number, Map<string, string>>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function findLocaleEdges(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const edges = findLocaleEdges(entry);
      if (edges.length > 0) return edges;
    }
    return [];
  }

  const record = asRecord(value);
  if (!record) return [];
  if (
    Array.isArray(record.edges) &&
    record.edges.some((edge) => readString(asRecord(asRecord(edge)?.node)?.code))
  ) {
    return record.edges;
  }

  for (const child of Object.values(record)) {
    const edges = findLocaleEdges(child);
    if (edges.length > 0) return edges;
  }
  return [];
}

export function parseCatalogLocales(value: unknown): CatalogLocale[] {
  const locales = findLocaleEdges(value).flatMap((edge) => {
    const node = asRecord(asRecord(edge)?.node);
    const code = readString(node?.code).trim();
    return code
      ? [{
          code,
          isDefault: node?.isDefault === true,
          status: readString(node?.status).toUpperCase(),
        }]
      : [];
  });

  return [...new Map(locales.map((locale) => [locale.code.toLowerCase(), locale])).values()]
    .sort((left, right) =>
      Number(right.isDefault) - Number(left.isDefault) ||
      left.code.localeCompare(right.code),
    );
}

export function selectCatalogLocale(
  locales: CatalogLocale[],
  requestedLocale?: string | null,
) {
  const requested = requestedLocale?.trim().toLowerCase();
  return (
    locales.find((locale) => locale.code.toLowerCase() === requested) ??
    locales.find((locale) => locale.isDefault) ??
    locales[0] ??
    null
  );
}

function findTranslationEdges(value: unknown): unknown[] {
  if (Array.isArray(value)) return [];
  const record = asRecord(value);
  if (!record) return [];
  if (
    Array.isArray(record.edges) &&
    record.edges.some((edge) => asRecord(asRecord(edge)?.node)?.resourceId)
  ) {
    return record.edges;
  }
  for (const child of Object.values(record)) {
    const edges = findTranslationEdges(child);
    if (edges.length > 0) return edges;
  }
  return [];
}

export function parseCatalogTranslations(value: unknown): CatalogTranslationFields {
  const translations: CatalogTranslationFields = new Map();
  for (const edge of findTranslationEdges(value)) {
    const node = asRecord(asRecord(edge)?.node);
    const resourceId = readString(node?.resourceId);
    const id = Number(resourceId.split("/").at(-1));
    if (!Number.isSafeInteger(id) || id < 1 || !Array.isArray(node?.fields)) continue;

    const fields = new Map<string, string>();
    for (const value of node.fields) {
      const field = asRecord(value);
      const name = readString(field?.fieldName).trim().toLowerCase();
      const translation = readString(field?.translation).trim();
      if (name && translation) fields.set(name, translation);
    }
    if (fields.size > 0) translations.set(id, fields);
  }
  return translations;
}

export function getSnapshotLocaleTranslations(value: unknown, localeCode: string) {
  const locales = asRecord(value);
  if (!locales) return new Map() as CatalogTranslationFields;
  const entry = Object.entries(locales).find(
    ([code]) => code.toLowerCase() === localeCode.toLowerCase(),
  );
  return parseCatalogTranslations(entry?.[1]);
}

export function toCatalogShortDescription(value: unknown) {
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

export function applyCatalogTranslations(
  categories: CatalogCategory[],
  products: CatalogProduct[],
  categoryTranslations: CatalogTranslationFields,
  productTranslations: CatalogTranslationFields,
) {
  const translateCategories = (values: CatalogCategory[]): CatalogCategory[] =>
    values.map((category) => ({
      ...category,
      name: categoryTranslations.get(category.id)?.get("name") ?? category.name,
      children: translateCategories(category.children),
    }));

  return {
    categories: translateCategories(categories),
    products: products.map((product) => {
      const fields = productTranslations.get(product.id);
      return {
        ...product,
        name: fields?.get("name") ?? product.name,
        description: fields?.get("description")
          ? toCatalogShortDescription(fields.get("description"))
          : product.description,
      };
    }),
  };
}
