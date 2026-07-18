export default function EnvironmentLoading() {
  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12" aria-hidden="true">
      <div className="mx-auto w-full max-w-5xl animate-pulse">
        <div className="h-5 w-24 rounded bg-black/5 dark:bg-white/8" />
        <div className="mt-9 h-10 w-64 rounded-lg bg-black/5 dark:bg-white/8" />
        <div className="mt-9 space-y-4">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-36 rounded-2xl border border-black/8 bg-black/3 dark:border-white/8 dark:bg-white/3"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
