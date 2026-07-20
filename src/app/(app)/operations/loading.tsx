export default function OperationsLoading() {
  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mx-auto w-full max-w-7xl animate-pulse">
        <div className="h-4 w-28 rounded bg-black/8 dark:bg-white/8" />
        <div className="mt-4 h-10 w-56 rounded bg-black/8 dark:bg-white/8" />
        <div className="mt-4 h-4 w-full max-w-xl rounded bg-black/8 dark:bg-white/8" />
        <div className="mt-10 h-20 rounded-2xl bg-black/8 dark:bg-white/8" />
        <div className="mt-4 h-96 rounded-2xl bg-black/8 dark:bg-white/8" />
      </div>
    </div>
  );
}
