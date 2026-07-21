import {
  ClientCollectionBrowser,
  type CollectionBrowserItem,
  type CollectionColumn,
} from "@/components/client-collection-browser";
import { requireAppUser } from "@/lib/auth";
import { getCollectionViewPreference } from "@/lib/db";

export type { CollectionBrowserItem, CollectionColumn };

export async function CollectionBrowser({
  collectionId,
  ariaLabel,
  items,
  columns,
  searchPlaceholder,
  cardsClassName,
  tableClassName,
  emptyMessage,
  allowSharedToggle = false,
  filterTags = [],
}: {
  collectionId: string;
  ariaLabel: string;
  items: CollectionBrowserItem[];
  columns: CollectionColumn[];
  searchPlaceholder: string;
  cardsClassName?: string;
  tableClassName?: string;
  emptyMessage?: string;
  allowSharedToggle?: boolean;
  filterTags?: string[];
}) {
  const user = await requireAppUser();
  const preference = await getCollectionViewPreference(user.id, collectionId);

  return (
    <ClientCollectionBrowser
      collectionId={collectionId}
      ariaLabel={ariaLabel}
      items={items}
      columns={columns}
      searchPlaceholder={searchPlaceholder}
      initialView={preference.viewMode}
      initialShowShared={allowSharedToggle ? preference.showShared : true}
      cardsClassName={cardsClassName}
      tableClassName={tableClassName}
      emptyMessage={emptyMessage}
      allowSharedToggle={allowSharedToggle}
      filterTags={filterTags}
    />
  );
}
