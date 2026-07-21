import { CollectionViewSkeleton } from "@/components/collection-view-skeleton";

function SectionHeadingSkeleton() {
  return (
    <div className="mb-5">
      <div className="h-3 w-24 rounded bg-emerald-500/20" />
      <div className="mt-3 h-7 w-64 max-w-full rounded bg-black/8 dark:bg-white/8" />
      <div className="mt-3 h-4 w-full max-w-2xl rounded bg-black/6 dark:bg-white/7" />
      <div className="mt-2 h-4 w-full max-w-lg rounded bg-black/6 dark:bg-white/7" />
    </div>
  );
}

export default function SettingsLoading() {
  return (
    <main
      aria-label="Loading application settings"
      aria-busy="true"
      className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12"
    >
      <div className="mx-auto w-full max-w-7xl animate-pulse">
        <header className="mb-10 border-b border-black/10 pb-7 dark:border-white/10">
          <div className="h-4 w-20 rounded bg-black/8 dark:bg-white/8" />
          <div className="mt-3 h-10 w-80 max-w-full rounded-lg bg-black/8 dark:bg-white/8" />
          <div className="mt-4 h-4 w-full max-w-2xl rounded bg-black/6 dark:bg-white/7" />
          <div className="mt-2 h-4 w-full max-w-xl rounded bg-black/6 dark:bg-white/7" />
        </header>

        <section>
          <SectionHeadingSkeleton />
          <div className="rounded-3xl border border-black/10 bg-white/45 p-5 sm:p-7 dark:border-white/10 dark:bg-white/3">
            <div className="grid gap-7 lg:grid-cols-[220px_1fr]">
              <div className="flex flex-col items-center gap-4 rounded-2xl bg-black/[0.025] p-5 dark:bg-white/[0.025]">
                <div className="size-24 rounded-full bg-black/8 dark:bg-white/9" />
                <div className="h-4 w-32 rounded bg-black/7 dark:bg-white/8" />
                <div className="h-9 w-28 rounded-xl bg-black/7 dark:bg-white/8" />
              </div>
              <div className="grid content-start gap-5 sm:grid-cols-2">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className={index === 4 ? "sm:col-span-2" : ""}>
                    <div className="mb-2 h-3 w-20 rounded bg-black/6 dark:bg-white/7" />
                    <div className="h-11 rounded-xl bg-black/7 dark:bg-white/8" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-14 border-t border-black/10 pt-10 dark:border-white/10">
          <SectionHeadingSkeleton />
          <div className="rounded-3xl border border-black/10 bg-white/45 p-5 sm:p-7 dark:border-white/10 dark:bg-white/3">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="w-full max-w-2xl">
                <div className="h-6 w-32 rounded bg-black/8 dark:bg-white/8" />
                <div className="mt-3 h-4 w-full rounded bg-black/6 dark:bg-white/7" />
                <div className="mt-2 h-4 w-3/4 rounded bg-black/6 dark:bg-white/7" />
              </div>
              <div className="h-16 w-48 rounded-2xl bg-black/6 dark:bg-white/7" />
            </div>
          </div>
        </section>

        <section className="mt-14 border-t border-black/10 pt-10 dark:border-white/10">
          <SectionHeadingSkeleton />
          <div className="rounded-3xl border border-black/10 bg-white/45 p-5 sm:p-7 dark:border-white/10 dark:bg-white/3">
            <div className="h-6 w-44 rounded bg-black/8 dark:bg-white/8" />
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index}>
                  <div className="mb-2 h-3 w-20 rounded bg-black/6 dark:bg-white/7" />
                  <div className="h-11 rounded-xl bg-black/7 dark:bg-white/8" />
                </div>
              ))}
            </div>
            <div className="mt-5 h-10 w-40 rounded-xl bg-black/8 dark:bg-white/9" />
          </div>

          <div className="mt-10">
            <div className="mb-5 h-7 w-56 rounded bg-black/8 dark:bg-white/8" />
            <CollectionViewSkeleton
              collectionId="settings-environments"
              cardCount={3}
              tableColumns={6}
              tableRows={5}
              cardClassName="h-80 rounded-3xl bg-black/4 dark:bg-white/5"
            />
          </div>
        </section>

        <section className="mt-14 border-t border-black/10 pt-10 dark:border-white/10">
          <SectionHeadingSkeleton />
          <div className="grid gap-5 md:grid-cols-2">
            {Array.from({ length: 2 }, (_, index) => (
              <div
                key={index}
                className="h-48 rounded-3xl border border-black/10 bg-white/45 dark:border-white/10 dark:bg-white/3"
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
