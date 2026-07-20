export const SNAPSHOT_RESTORE_GROUPS = [
  {
    id: "catalog",
    label: "Catalog",
    description: "Categories, products, variants, images, metadata, and channel assignments.",
    scope: "channel",
    defaultChecked: true,
  },
  {
    id: "channel",
    label: "Channel & routing",
    description: "Inspect-only channel properties, metafields, site ownership, and routes.",
    scope: "channel",
    defaultChecked: false,
  },
  {
    id: "storefront",
    label: "Storefront settings",
    description: "Status messages, contact and branding, SEO, display, catalog, inventory, search, and customer privacy overrides.",
    scope: "channel",
    defaultChecked: false,
  },
  {
    id: "experience",
    label: "Checkout & customer experience",
    description: "Checkout, cart, order, and abandoned-cart settings for this channel.",
    scope: "channel",
    defaultChecked: false,
  },
  {
    id: "pricing",
    label: "Pricing & currencies",
    description: "Channel currency and price-list assignments, plus assigned price-list definitions and records.",
    scope: "mixed",
    defaultChecked: false,
  },
  {
    id: "shipping",
    label: "Shipping",
    description: "Channel shipping settings plus store-wide zones and methods.",
    scope: "store",
    defaultChecked: false,
  },
  {
    id: "tax",
    label: "Tax",
    description: "Store-wide tax settings, zones, rates, and tax classes.",
    scope: "store",
    defaultChecked: false,
  },
  {
    id: "inventory",
    label: "Inventory & locations",
    description: "Store inventory settings and location definitions; product and variant stock is already present in the catalog manifest.",
    scope: "store",
    defaultChecked: false,
  },
  {
    id: "b2b",
    label: "B2B Edition",
    description: "Store-wide B2B roles, Companies, users, addresses, hierarchies, quotes, orders, shopping lists, invoices, payments, and related demo data.",
    scope: "store",
    defaultChecked: false,
  },
  {
    id: "localization",
    label: "Localization & presentation",
    description: "Catalyst channel locales, the channel default country, and theme configuration metadata.",
    scope: "mixed",
    defaultChecked: false,
  },
] as const;

export type SnapshotRestoreGroup =
  (typeof SNAPSHOT_RESTORE_GROUPS)[number]["id"];

export type CapturedConfigurationResource = {
  label: string;
  scope: "channel" | "site" | "store";
  data: unknown;
  warning?: string;
};

export type CapturedConfigurationGroup = {
  resources: Record<string, CapturedConfigurationResource>;
};

export type CapturedSnapshotConfiguration = Partial<
  Record<Exclude<SnapshotRestoreGroup, "catalog">, CapturedConfigurationGroup>
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsTranslationEdges(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsTranslationEdges);
  }

  if (!isRecord(value)) return false;
  if (Array.isArray(value.edges) && value.edges.length > 0) return true;

  return Object.values(value).some(containsTranslationEdges);
}

export function hasCapturedTranslations(
  configuration: CapturedSnapshotConfiguration | null | undefined,
) {
  const localization = configuration?.localization;
  if (!localization) return false;

  return ["productTranslations", "categoryTranslations"].some((resourceName) => {
    const resource = localization.resources[resourceName];
    return resource ? containsTranslationEdges(resource.data) : false;
  });
}

const validRestoreGroups = new Set<string>(
  SNAPSHOT_RESTORE_GROUPS
    .filter((group) => group.id !== "channel")
    .map((group) => group.id),
);

export function isSnapshotRestoreGroupRestorable(
  group: SnapshotRestoreGroup,
) {
  return group !== "channel";
}

export function parseSnapshotRestoreGroups(value: unknown) {
  const values = Array.isArray(value) ? value : [];
  const groups = values.flatMap((entry) =>
    typeof entry === "string" && validRestoreGroups.has(entry)
      ? [entry as SnapshotRestoreGroup]
      : [],
  );
  return [...new Set(groups)];
}
