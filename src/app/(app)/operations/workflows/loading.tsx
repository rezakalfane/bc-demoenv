export default function WorkflowsLoading() {
  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-8 xl:px-10">
      <div className="w-full animate-pulse">
        <div className="h-4 w-36 rounded bg-black/8 dark:bg-white/8" />
        <div className="mt-4 h-10 w-56 rounded bg-black/8 dark:bg-white/8" />
        <div className="mt-4 h-4 w-full max-w-2xl rounded bg-black/8 dark:bg-white/8" />
        <div className="mt-10 h-16 rounded-2xl bg-black/8 dark:bg-white/8" />
        <div className="mt-4 overflow-hidden rounded-2xl border border-black/8 dark:border-white/8">
          <div className="h-12 bg-black/8 dark:bg-white/8" />
          {Array.from({ length: 7 }).map((_, index) => <div key={index} className="h-20 border-t border-black/5 bg-black/[0.025] dark:border-white/5 dark:bg-white/[0.025]" />)}
        </div>
      </div>
    </div>
  );
}
