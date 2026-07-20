import { CollectionViewSkeleton } from "@/components/collection-view-skeleton";

export default function SnapshotLoading() {
  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-10" aria-hidden="true">
      <div className="mx-auto w-full max-w-[1320px] animate-pulse">
        <div className="h-5 w-24 rounded bg-black/5 dark:bg-white/8" />
        <div className="mt-9 h-10 w-72 rounded-lg bg-black/5 dark:bg-white/8" />
        <div className="mt-12 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="h-96 rounded-2xl bg-black/4 dark:bg-white/5" />
          <CollectionViewSkeleton
            collectionId="snapshot-products"
            cardCount={10}
            tableColumns={4}
            tableRows={10}
            cardsClassName="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
            cardClassName="h-64 rounded-2xl bg-black/4 dark:bg-white/5"
          />
        </div>
      </div>
    </div>
  );
}
