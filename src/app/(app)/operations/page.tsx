import { CatalogOperationsTable } from "@/components/catalog-operations-table";
import { requireAppUser } from "@/lib/auth";
import { getCatalogOperationList } from "@/lib/catalog-operations-list";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const user = await requireAppUser();
  const operations = await getCatalogOperationList(user.id);
  const activeCount = operations.filter((operation) =>
    operation.status === "queued" || operation.status === "running").length;
  const attentionCount = operations.filter((operation) =>
    operation.error || operation.warnings.length > 0 || operation.manualActions.length > 0).length;
  const completedCount = operations.filter((operation) => operation.status === "completed").length;

  return (
    <div data-operations-workspace className="px-5 py-8 sm:px-8 sm:py-12 lg:px-8 xl:px-10">
      <div className="mx-auto w-full max-w-none">
        <header className="mb-7 border-b border-black/10 pb-7 dark:border-white/10">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Activity ledger
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                Operations
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-black/55 dark:text-white/55">
                Monitor current catalog work and inspect catalog, snapshot lifecycle, and
                environment activity across your account.
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="min-w-24 rounded-xl border border-black/8 bg-white/55 px-3 py-2 dark:border-white/8 dark:bg-white/3">
                <dt className="text-[11px] text-black/40 dark:text-white/40">Active</dt>
                <dd className="mt-0.5 text-lg font-semibold text-sky-700 dark:text-sky-300">{activeCount}</dd>
              </div>
              <div className="min-w-24 rounded-xl border border-black/8 bg-white/55 px-3 py-2 dark:border-white/8 dark:bg-white/3">
                <dt className="text-[11px] text-black/40 dark:text-white/40">Completed</dt>
                <dd className="mt-0.5 text-lg font-semibold text-emerald-700 dark:text-emerald-300">{completedCount}</dd>
              </div>
              <div className="min-w-24 rounded-xl border border-black/8 bg-white/55 px-3 py-2 dark:border-white/8 dark:bg-white/3">
                <dt className="text-[11px] text-black/40 dark:text-white/40">Attention</dt>
                <dd className="mt-0.5 text-lg font-semibold text-amber-700 dark:text-amber-300">{attentionCount}</dd>
              </div>
            </dl>
          </div>
        </header>

        {operations.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-black/15 px-6 py-16 text-center dark:border-white/15">
            <p className="font-medium">No catalog operations have been recorded yet.</p>
            <p className="mt-1 text-sm text-black/45 dark:text-white/45">
              Snapshot captures, restores, and catalog clears will appear here.
            </p>
          </div>
        ) : (
          <CatalogOperationsTable
            operations={operations}
            generatedAt={new Date().toISOString()}
          />
        )}
      </div>
    </div>
  );
}
