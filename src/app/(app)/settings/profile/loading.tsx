export default function ProfileLoading() {
  return (
    <main className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mx-auto w-full max-w-5xl animate-pulse">
        <div className="h-5 w-28 rounded bg-black/8 dark:bg-white/8" />
        <div className="mt-4 h-10 w-80 max-w-full rounded bg-black/8 dark:bg-white/8" />
        <div className="mt-10 h-72 rounded-3xl bg-black/6 dark:bg-white/6" />
        <div className="mt-8 h-96 rounded-3xl bg-black/6 dark:bg-white/6" />
      </div>
    </main>
  );
}
