"use client";

import Image from "next/image";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAppI18n } from "@/components/app-i18n-provider";
import type {
  CatalogProduct,
  ProductDetailRecord,
} from "@/lib/catalog-types";

type JsonRecord = Record<string, unknown>;
type ProductInspectorSource = "snapshot" | "bigcommerce";

const PRODUCT_GROUPS = [
  {
    id: "identity",
    title: "Identity",
    keys: [
      "id", "name", "type", "sku", "mpn", "gtin", "upc", "brand_id",
      "availability", "availability_description", "condition",
    ],
  },
  {
    id: "commerce",
    title: "Commerce",
    keys: [
      "price", "cost_price", "retail_price", "sale_price", "map_price",
      "calculated_price", "currency", "tax_class_id", "tax_class",
      "is_price_hidden", "price_hidden_label",
    ],
  },
  {
    id: "inventory",
    title: "Inventory & fulfillment",
    keys: [
      "inventory_level", "inventory_warning_level", "inventory_tracking",
      "inventory_tracking_by", "fixed_cost_shipping_price", "is_free_shipping",
      "shipping_price", "weight", "width", "height", "depth",
      "purchasing_disabled", "purchasing_disabled_message",
      "order_quantity_minimum", "order_quantity_maximum",
    ],
  },
  {
    id: "organization",
    title: "Organization & visibility",
    keys: [
      "brand_name", "categories", "category_ids", "sort_order", "is_visible",
      "is_featured", "related_products", "warranty", "bin_picking_number",
      "date_created", "date_modified",
    ],
  },
  {
    id: "content",
    title: "Content & search",
    keys: [
      "description", "page_title", "meta_keywords", "meta_description",
      "search_keywords", "custom_url", "open_graph_type",
      "open_graph_title", "open_graph_description",
      "open_graph_use_meta_description", "open_graph_use_product_name",
      "open_graph_use_image",
    ],
  },
] as const;

const COLLECTION_GROUPS = [
  { key: "variants", title: "Variants" },
  { key: "images", title: "Images" },
  { key: "custom_fields", title: "Custom fields" },
  { key: "options", title: "Options" },
  { key: "modifiers", title: "Modifiers" },
  { key: "bulk_pricing_rules", title: "Bulk pricing rules" },
  { key: "videos", title: "Videos" },
] as const;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function labelFor(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_id$/i, " ID")
    .replace(/_/g, " ")
    .replace(/\bId\b/g, "ID")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function htmlToPlainText(value: string) {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&apos;": "'",
    "&gt;": ">",
    "&lt;": "<",
    "&nbsp;": " ",
    "&quot;": "\"",
  };

  return value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/(?:div|h[1-6]|li|p)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|apos|gt|lt|nbsp|quot);/gi, (entity) => entities[entity.toLowerCase()] ?? entity)
    .replace(/&#(\d+);/g, (entity, code) => {
      const codePoint = Number(code);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function PrimitiveValue({ value }: { value: unknown }) {
  const { t } = useAppI18n();
  if (value === null || value === undefined || value === "") {
    return <span className="text-black/30 dark:text-white/30">{t("Not captured")}</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        value
          ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300"
          : "bg-black/6 text-black/50 dark:bg-white/8 dark:text-white/50"
      }`}>
        {value ? t("Yes") : t("No")}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="font-mono tabular-nums">{value}</span>;
  }
  return <span className="break-words">{String(value)}</span>;
}

function CapturedValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <PrimitiveValue value={null} />;
    return (
      <div className="space-y-2">
        {value.map((entry, index) => (
          <div
            key={index}
            className="rounded-xl border border-black/7 bg-black/[0.018] p-3 dark:border-white/8 dark:bg-white/[0.025]"
          >
            <CapturedValue value={entry} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  const record = asRecord(value);
  if (!record) return <PrimitiveValue value={value} />;

  const entries = Object.entries(record);
  if (entries.length === 0) return <PrimitiveValue value={null} />;
  const compactIdentityColumn = "variantId" in record && "data" in record;

  return (
    <dl className={`grid gap-x-4 gap-y-2 ${
      compactIdentityColumn
        ? "sm:grid-cols-[7rem_minmax(0,1fr)]"
        : depth < 2
          ? "sm:grid-cols-2"
          : ""
    }`}>
      {entries.map(([key, entry]) => (
        <div key={key} className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
            {labelFor(key)}
          </dt>
          <dd className="mt-0.5 text-xs leading-5 text-black/70 dark:text-white/70">
            <CapturedValue value={entry} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FieldGrid({ entries }: { entries: [string, unknown][] }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map(([key, value]) => {
        const spanClass = key === "description"
          ? "sm:col-span-2 xl:col-span-3"
          : key === "primary_image" || key === "categories" || key === "category_ids"
            ? "sm:col-span-2 xl:col-span-2"
            : "";
        const readableDescription = key === "description" && typeof value === "string"
          ? htmlToPlainText(value)
          : null;

        return (
          <div
            key={key}
            className={`min-w-0 rounded-xl border border-black/7 bg-black/[0.018] px-3.5 py-3 dark:border-white/8 dark:bg-white/[0.025] ${spanClass}`}
          >
            <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
              {labelFor(key)}
            </dt>
            <dd className="mt-1 text-sm leading-5 text-black/75 dark:text-white/75">
              {readableDescription !== null
                ? <span className="whitespace-pre-line">{readableDescription}</span>
                : <CapturedValue value={value} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function ImageCollection({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (
    <div className="space-y-3">
      {value.map((entry, index) => {
        const record = asRecord(entry);
        const url = typeof record?.url_standard === "string"
          ? record.url_standard
          : typeof record?.url_zoom === "string"
            ? record.url_zoom
            : null;
        return (
          <div
            key={index}
            className={`grid min-w-0 overflow-hidden rounded-2xl border border-black/8 dark:border-white/8 ${
              url ? "lg:grid-cols-[minmax(280px,42%)_minmax(0,1fr)]" : ""
            }`}
          >
            {url ? (
              <div className="relative min-h-72 bg-black/4 lg:min-h-[420px] dark:bg-white/4">
                <Image
                  src={url}
                  alt={typeof record?.description === "string" ? record.description : ""}
                  fill
                  sizes="(min-width: 1280px) 420px, (min-width: 1024px) 38vw, 85vw"
                  className="object-contain p-5"
                />
              </div>
            ) : null}
            <div className="min-w-0 border-t border-black/8 p-4 lg:border-l lg:border-t-0 lg:p-5 dark:border-white/8">
              <CapturedValue value={entry} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InspectorSection({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const { t } = useAppI18n();
  return (
    <section id={`product-section-${id}`} className="scroll-mt-24 border-t border-black/8 pt-6 dark:border-white/8">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-base font-semibold tracking-tight">{t(title)}</h3>
        {count !== undefined ? (
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-black/45 dark:bg-white/7 dark:text-white/45">
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const ProductInspectorContext = createContext<((product: CatalogProduct) => void) | null>(null);

export function ProductInspectorProvider({
  endpoint,
  source,
  children,
}: {
  endpoint: string;
  source: ProductInspectorSource;
  children: ReactNode;
}) {
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const selectProduct = useCallback((product: CatalogProduct) => {
    previousFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setSelectedProduct(product);
  }, []);
  const closeInspector = useCallback(() => {
    setSelectedProduct(null);
    requestAnimationFrame(() => previousFocus.current?.focus());
  }, []);

  return (
    <ProductInspectorContext value={selectProduct}>
      {children}
      {selectedProduct ? (
        <ProductInspectorDialog
          key={selectedProduct.id}
          product={selectedProduct}
          endpoint={`${endpoint}/${selectedProduct.id}`}
          source={source}
          onClose={closeInspector}
        />
      ) : null}
    </ProductInspectorContext>
  );
}

export function ProductInspectorTrigger({
  product,
  trigger,
  triggerClassName,
  cardTrigger = false,
}: {
  product: CatalogProduct;
  trigger: ReactNode;
  triggerClassName?: string;
  cardTrigger?: boolean;
}) {
  const selectProduct = useContext(ProductInspectorContext);
  if (!selectProduct) {
    throw new Error("ProductInspectorTrigger must be inside its provider.");
  }

  return cardTrigger ? (
    <div
      role="button"
      tabIndex={0}
      className={triggerClassName}
      onClick={() => selectProduct(product)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectProduct(product);
        }
      }}
      aria-haspopup="dialog"
    >
      {trigger}
    </div>
  ) : (
    <button
      type="button"
      className={triggerClassName}
      onClick={() => selectProduct(product)}
      aria-haspopup="dialog"
    >
      {trigger}
    </button>
  );
}

function ProductInspectorDialog({
  product,
  endpoint,
  source,
  onClose,
}: {
  product: CatalogProduct;
  endpoint: string;
  source: ProductInspectorSource;
  onClose: () => void;
}) {
  const { t } = useAppI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [record, setRecord] = useState<ProductDetailRecord | null>();
  const [loadError, setLoadError] = useState(false);
  const data = record?.data ?? {};
  const usedKeys = new Set<string>();

  const fieldGroups = PRODUCT_GROUPS.flatMap((group) => {
    const entries = group.keys.flatMap((key) => {
      if (!(key in data)) return [];
      usedKeys.add(key);
      return [[key, data[key]] as [string, unknown]];
    });
    return entries.length > 0 ? [{ ...group, entries }] : [];
  });

  const collections = COLLECTION_GROUPS.flatMap((group) => {
    if (!(group.key in data)) return [];
    usedKeys.add(group.key);
    const value = data[group.key];
    return Array.isArray(value) && value.length > 0
      ? [{ ...group, value }]
      : [];
  });

  const additionalEntries = Object.entries(data).filter(([key]) => !usedKeys.has(key));
  const navItems = [
    ...fieldGroups.map((group) => ({ id: group.id, title: group.title })),
    ...collections.map((group) => ({ id: group.key, title: group.title })),
    ...(record?.metafields.length ? [{ id: "metafields", title: "Product metafields" }] : []),
    ...(record?.variantMetafields.length ? [{ id: "variant-metafields", title: "Variant metafields" }] : []),
    ...(additionalEntries.length
      ? [{
          id: "additional",
          title: source === "snapshot"
            ? "Additional captured fields"
            : "Additional BigCommerce fields",
        }]
      : []),
  ];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
      closeRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (record !== undefined || loadError) return;
    const controller = new AbortController();

    fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load product details.");
        return response.json() as Promise<{ record: ProductDetailRecord }>;
      })
      .then((payload) => setRecord(payload.record))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRecord(null);
        setLoadError(true);
      });

    return () => controller.abort();
  }, [endpoint, loadError, record]);

  return (
    <dialog
        ref={dialogRef}
        aria-labelledby={`product-inspector-title-${product.id}`}
        onCancel={onClose}
        onClose={onClose}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        className="m-auto h-[min(900px,calc(100dvh-2rem))] w-[min(1180px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-[28px] border border-black/12 bg-[#f7f8f5] p-0 text-black shadow-2xl backdrop:bg-black/70 dark:border-white/12 dark:bg-[#0c100e] dark:text-white"
      >
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex shrink-0 items-start gap-4 border-b border-black/8 bg-[#f7f8f5]/95 px-5 py-4 backdrop-blur sm:px-7 sm:py-5 dark:border-white/8 dark:bg-[#0c100e]/95">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
                {t(source === "snapshot" ? "Captured product" : "BigCommerce product")}
              </p>
              <h2
                id={`product-inspector-title-${product.id}`}
                className="mt-1 truncate text-xl font-semibold tracking-[-0.025em] sm:text-2xl"
              >
                {product.name}
              </h2>
              <p className="mt-1 font-mono text-xs text-black/40 dark:text-white/40">
                {t("Product ID")} {product.id}
                {typeof data.sku === "string" && data.sku ? ` · SKU ${data.sku}` : ""}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="grid size-10 shrink-0 place-items-center rounded-full border border-black/10 text-xl text-black/55 transition hover:bg-black/5 hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-white/12 dark:text-white/55 dark:hover:bg-white/8 dark:hover:text-white"
              aria-label={t("Close product details")}
            >
              ×
            </button>
          </header>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[210px_minmax(0,1fr)]">
            <aside className="hidden border-r border-black/8 p-5 lg:block dark:border-white/8">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black/35 dark:text-white/35">
                {t(source === "snapshot" ? "Captured fields" : "BigCommerce fields")}
              </p>
              <nav aria-label={t("Product detail sections")} className="sticky top-5 space-y-0.5">
                {navItems.map((item) => (
                  <a
                    key={item.id}
                    href={`#product-section-${item.id}`}
                    className="block rounded-lg px-2.5 py-2 text-xs font-medium text-black/50 transition hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/6 dark:hover:text-white"
                  >
                    {t(item.title)}
                  </a>
                ))}
              </nav>
            </aside>

            <div className="min-h-0 overflow-y-auto scroll-smooth px-5 pb-10 sm:px-7">
              {record === undefined ? (
                <div className="mt-7 grid min-h-44 place-items-center rounded-2xl border border-black/8 bg-black/[0.018] dark:border-white/8 dark:bg-white/[0.025]">
                  <div className="text-center">
                    <span className="mx-auto block size-6 animate-spin rounded-full border-2 border-emerald-500/25 border-t-emerald-600" />
                    <p className="mt-3 text-sm text-black/45 dark:text-white/45">
                      {t(source === "snapshot" ? "Loading captured fields…" : "Loading BigCommerce fields…")}
                    </p>
                  </div>
                </div>
              ) : null}

              {record === null ? (
                <div className="mt-7 rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4 text-sm text-amber-900 dark:text-amber-200">
                  {t(source === "snapshot"
                    ? "The complete captured product record is unavailable."
                    : "The complete product record could not be loaded from BigCommerce.")}
                </div>
              ) : null}

              {fieldGroups.map((group) => (
                <InspectorSection key={group.id} id={group.id} title={group.title}>
                  <FieldGrid entries={group.entries} />
                </InspectorSection>
              ))}

              {collections.map((group) => (
                <InspectorSection
                  key={group.key}
                  id={group.key}
                  title={group.title}
                  count={group.value.length}
                >
                  {group.key === "images"
                    ? <ImageCollection value={group.value} />
                    : <CapturedValue value={group.value} />}
                </InspectorSection>
              ))}

              {record?.metafields.length ? (
                <InspectorSection
                  id="metafields"
                  title="Product metafields"
                  count={record.metafields.length}
                >
                  <CapturedValue value={record.metafields} />
                </InspectorSection>
              ) : null}

              {record?.variantMetafields.length ? (
                <InspectorSection
                  id="variant-metafields"
                  title="Variant metafields"
                  count={record.variantMetafields.length}
                >
                  <CapturedValue value={record.variantMetafields} />
                </InspectorSection>
              ) : null}

              {additionalEntries.length ? (
                <InspectorSection
                  id="additional"
                  title={source === "snapshot"
                    ? "Additional captured fields"
                    : "Additional BigCommerce fields"}
                >
                  <FieldGrid entries={additionalEntries} />
                </InspectorSection>
              ) : null}
            </div>
          </div>
        </div>
    </dialog>
  );
}
