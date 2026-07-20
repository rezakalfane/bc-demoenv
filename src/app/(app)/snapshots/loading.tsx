import { CollectionViewSkeleton } from "@/components/collection-view-skeleton";

export default function SnapshotsLoading() {
  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12" aria-hidden="true">
      <div className="mx-auto w-full max-w-6xl animate-pulse">
        <div className="h-10 w-72 rounded-lg bg-black/5 dark:bg-white/8" />
        <div className="mt-12">
          <CollectionViewSkeleton
            collectionId="snapshot-series"
            tableColumns={7}
            sharedToggle
          />
        </div>
      </div>
    </div>
  );
}
