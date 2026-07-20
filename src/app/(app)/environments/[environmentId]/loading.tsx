import { CollectionViewSkeleton } from "@/components/collection-view-skeleton";

export default function EnvironmentLoading() {
  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12" aria-hidden="true">
      <div className="mx-auto w-full max-w-6xl animate-pulse">
        <div className="h-5 w-24 rounded bg-black/5 dark:bg-white/8" />
        <div className="mt-9 h-10 w-64 rounded-lg bg-black/5 dark:bg-white/8" />
        <div className="mt-9">
          <CollectionViewSkeleton
            collectionId="environment-channels"
            tableColumns={9}
            cardClassName="h-80 rounded-3xl bg-black/4 dark:bg-white/5"
          />
        </div>
      </div>
    </div>
  );
}
