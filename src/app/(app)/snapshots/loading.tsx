export default function SnapshotsLoading() {
  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12" aria-hidden="true">
      <div className="mx-auto w-full max-w-6xl animate-pulse">
        <div className="h-10 w-72 rounded-lg bg-black/5 dark:bg-white/8" />
        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-72 rounded-3xl bg-black/4 dark:bg-white/5"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
