export default function SchedulerLoading() {
  return (
    <main
      aria-label="Loading catalog schedules"
      aria-busy="true"
      className="px-5 py-8 sm:px-8 sm:py-12 lg:px-10"
    >
      <div className="mx-auto w-full max-w-[1560px] animate-pulse">
        <div className="h-4 w-24 rounded bg-black/8 dark:bg-white/8" />
        <div className="mt-4 h-10 w-72 max-w-full rounded bg-black/8 dark:bg-white/8" />
        <div className="mt-4 h-4 w-full max-w-3xl rounded bg-black/8 dark:bg-white/8" />
        <div className="mt-2 h-4 w-full max-w-xl rounded bg-black/8 dark:bg-white/8" />

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <div className="h-11 w-full max-w-md rounded-xl bg-black/8 dark:bg-white/8" />
          <div className="flex gap-2">
            <div className="h-10 w-28 rounded-xl bg-black/8 dark:bg-white/8" />
            <div className="h-10 w-36 rounded-xl bg-black/8 dark:bg-white/8" />
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-black/8 dark:border-white/8">
          <div className="grid h-12 grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr_180px] gap-4 bg-black/6 px-5 dark:bg-white/6">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="my-auto h-3 w-2/3 rounded bg-black/8 dark:bg-white/8"
              />
            ))}
          </div>
          {Array.from({ length: 6 }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="grid min-h-20 grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr_180px] items-center gap-4 border-t border-black/6 px-5 dark:border-white/6"
            >
              {Array.from({ length: 5 }).map((_, cellIndex) => (
                <div
                  key={cellIndex}
                  className={`h-3 rounded bg-black/8 dark:bg-white/8 ${cellIndex === 0 ? "w-3/4" : "w-1/2"}`}
                />
              ))}
              <div className="flex justify-end gap-2">
                {Array.from({ length: 4 }).map((_, actionIndex) => (
                  <div
                    key={actionIndex}
                    className="size-9 rounded-lg bg-black/8 dark:bg-white/8"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
