import { OperationsSubnavigation } from "@/components/operations-subnavigation";
import { WorkflowRunsExplorer } from "@/components/workflow-runs-explorer";
import { requireAppUser } from "@/lib/auth";
import { getWorkflowRunList } from "@/lib/workflow-observability";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ operation?: string | string[] }>;
}) {
  const user = await requireAppUser();
  const operationParam = (await searchParams).operation;
  const initialOperationId = Number(Array.isArray(operationParam) ? operationParam[0] : operationParam);
  const runs = await getWorkflowRunList(user.id);
  const activeCount = runs.filter((run) => run.canCancel).length;
  const completedCount = runs.filter((run) => run.appStatus === "completed").length;
  const failedCount = runs.filter((run) => run.appStatus === "failed").length;
  const attentionCount = runs.filter((run) => run.error || run.warningCount || run.manualActionCount).length;

  return (
    <div data-operations-workspace className="px-5 py-8 sm:px-8 sm:py-12 lg:px-8 xl:px-10">
      <div className="mx-auto w-full max-w-none">
        <header className="mb-7 border-b border-black/10 pb-7 dark:border-white/10">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Workflow observability</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Workflows</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-black/55 dark:text-white/55">
                Inspect durable catalog runs, checkpoints, application and runtime status, errors,
                and safe controls. Double-click a row for its visual execution trace.
              </p>
              <OperationsSubnavigation active="workflows" />
            </div>
            <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {[
                ["Active", activeCount, "text-sky-700 dark:text-sky-300"],
                ["Completed", completedCount, "text-emerald-700 dark:text-emerald-300"],
                ["Failed", failedCount, "text-red-700 dark:text-red-300"],
                ["Attention", attentionCount, "text-amber-700 dark:text-amber-300"],
              ].map(([label, value, color]) => (
                <div key={String(label)} className="min-w-24 rounded-xl border border-black/8 bg-white/55 px-3 py-2 dark:border-white/8 dark:bg-white/3">
                  <dt className="text-[11px] text-black/40 dark:text-white/40">{label}</dt>
                  <dd className={`mt-0.5 text-lg font-semibold ${color}`}>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </header>

        {runs.length > 0 ? (
          <WorkflowRunsExplorer
            runs={runs}
            initialSelectedOperationId={Number.isInteger(initialOperationId) && initialOperationId > 0
              ? initialOperationId
              : null}
          />
        ) : (
          <div className="rounded-3xl border border-dashed border-black/15 px-6 py-16 text-center dark:border-white/15">
            <p className="font-medium">No durable workflow runs have been recorded yet.</p>
            <p className="mt-1 text-sm text-black/45 dark:text-white/45">Snapshot captures, restores, and catalog clears will appear here.</p>
          </div>
        )}

        <p className="mt-5 text-xs leading-5 text-black/35 dark:text-white/35">
          The application retains tenant-scoped audit and checkpoint data. Native Vercel traces and
          function logs are intentionally not exposed through application credentials; use the
          Vercel Workflow dashboard or Workflow CLI with an authorized project account for those.
        </p>
      </div>
    </div>
  );
}
