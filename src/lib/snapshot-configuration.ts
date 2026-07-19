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
    label: "Channel & storefront",
    description: "Channel properties and metafields plus site routes. Domain and checkout URLs remain destination-specific.",
    scope: "channel",
    defaultChecked: false,
  },
  {
    id: "experience",
    label: "Checkout & customer experience",
    description: "Checkout, cart, customer, order, and abandoned-cart settings for this channel.",
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
    description: "Catalyst channel locales, store locale defaults, and theme configuration metadata.",
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

const validRestoreGroups = new Set<string>(
  SNAPSHOT_RESTORE_GROUPS.map((group) => group.id),
);

export function parseSnapshotRestoreGroups(value: unknown) {
  const values = Array.isArray(value) ? value : [];
  const groups = values.flatMap((entry) =>
    typeof entry === "string" && validRestoreGroups.has(entry)
      ? [entry as SnapshotRestoreGroup]
      : [],
  );
  return [...new Set(groups)];
}
