import { Fragment, type ReactNode } from "react";
import { CollectionToolbar } from "@/components/collection-toolbar";

export type CollectionColumn = {
  key: string;
  label: string;
  className?: string;
  align?: "left" | "right";
};

export type CollectionBrowserItem = {
  id: string;
  searchText: string;
  isShared?: boolean;
  card: ReactNode;
  cells: ReactNode[];
};

export function CollectionBrowser({
  collectionId,
  ariaLabel,
  items,
  columns,
  searchPlaceholder,
  cardsClassName = "grid gap-5 md:grid-cols-2 xl:grid-cols-3",
  emptyMessage = "No items match your search.",
  allowSharedToggle = false,
}: {
  collectionId: string;
  ariaLabel: string;
  items: CollectionBrowserItem[];
  columns: CollectionColumn[];
  searchPlaceholder: string;
  cardsClassName?: string;
  emptyMessage?: string;
  allowSharedToggle?: boolean;
}) {
  return (
    <section id={collectionId} aria-label={ariaLabel}>
      <CollectionToolbar
        collectionId={collectionId}
        ariaLabel={ariaLabel}
        searchPlaceholder={searchPlaceholder}
        itemCount={items.length}
        allowSharedToggle={allowSharedToggle}
      />

      <div data-collection-cards className={cardsClassName}>
        {items.map((item) => (
          <div
            key={item.id}
            className="contents"
            data-collection-entry
            data-search-text={item.searchText.toLocaleLowerCase("en-US")}
            data-shared={item.isShared ? "true" : "false"}
          >
            <Fragment>{item.card}</Fragment>
          </div>
        ))}
      </div>

      <div data-collection-table hidden className="overflow-hidden rounded-2xl border border-black/8 bg-white/55 dark:border-white/8 dark:bg-white/3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left text-xs">
            <thead className="border-b border-black/8 bg-black/[0.025] dark:border-white/8 dark:bg-white/[0.025]">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`whitespace-nowrap px-3 py-3 font-semibold text-black/50 dark:text-white/50 ${column.align === "right" ? "text-right" : ""} ${column.className ?? ""}`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/6 dark:divide-white/6">
              {items.map((item) => (
                <tr
                  key={item.id}
                  data-collection-entry
                  data-search-text={item.searchText.toLocaleLowerCase("en-US")}
                  data-shared={item.isShared ? "true" : "false"}
                  className="align-middle transition hover:bg-black/[0.025] dark:hover:bg-white/[0.025]"
                >
                  {columns.map((column, index) => (
                    <td key={column.key} className={`px-3 py-2.5 ${column.align === "right" ? "text-right" : ""} ${column.className ?? ""}`}>
                      {item.cells[index] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div data-collection-empty hidden className="rounded-2xl border border-dashed border-black/15 px-6 py-12 text-center dark:border-white/15">
        <p className="font-medium">{emptyMessage}</p>
        <p className="mt-1 text-sm text-black/45 dark:text-white/45">Try a different search or display filter.</p>
      </div>
    </section>
  );
}
