export default function NotesLoading() {
  return (
    <main
      aria-label="Loading notes"
      aria-busy="true"
      className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12"
    >
      <div className="mx-auto w-full max-w-4xl animate-pulse">
        <header className="mb-8 flex flex-col gap-5 border-b border-black/10 pb-7 dark:border-white/10 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full max-w-xl">
            <div className="h-4 w-16 rounded bg-black/8 dark:bg-white/8" />
            <div className="mt-3 h-10 w-48 rounded-lg bg-black/8 dark:bg-white/8" />
            <div className="mt-4 h-4 w-full rounded bg-black/6 dark:bg-white/7" />
          </div>
          <div className="h-8 w-20 shrink-0 rounded-full bg-black/7 dark:bg-white/8" />
        </header>

        <div className="mb-10 flex gap-3">
          <div className="h-[50px] min-w-0 flex-1 rounded-2xl bg-black/7 dark:bg-white/8" />
          <div className="h-[50px] w-24 shrink-0 rounded-2xl bg-black/9 dark:bg-white/10" />
        </div>

        <div className="divide-y divide-black/8 overflow-hidden rounded-3xl border border-black/10 bg-white/45 dark:divide-white/8 dark:border-white/10 dark:bg-white/3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex h-[57px] items-center gap-4 px-5 sm:px-6">
              <div className="size-2 shrink-0 rounded-full bg-emerald-500/45" />
              <div
                className={`h-3.5 rounded bg-black/7 dark:bg-white/8 ${
                  index % 3 === 0 ? "w-2/3" : index % 3 === 1 ? "w-1/2" : "w-3/4"
                }`}
              />
              <div className="ml-auto hidden h-3 w-12 shrink-0 rounded bg-black/5 sm:block dark:bg-white/6" />
              <div className="h-7 w-12 shrink-0 rounded-lg bg-black/5 dark:bg-white/6" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
