import Link from "next/link";

import { SchedulerWorkspace } from "@/components/scheduler-workspace";
import { requireAppUser } from "@/lib/auth";
import {
  getFavoriteResourceKeys,
  getSnapshotFavoriteKey,
  getCatalogOperation,
  getCatalogSchedules,
  getCatalogSnapshots,
  getUserProfile,
} from "@/lib/db";
import { getCatalogRestoreDestinations } from "@/lib/catalog-restore";

export const dynamic = "force-dynamic";

export default async function SchedulerPage() {
  const user = await requireAppUser();
  const [schedules, destinations, snapshots, snapshotFavoriteKeys, profile] = await Promise.all([
    getCatalogSchedules(user.id),
    getCatalogRestoreDestinations(),
    getCatalogSnapshots(user.id),
    getFavoriteResourceKeys(user.id, "snapshot"),
    getUserProfile(user.id, {
      firstName: user.firstName,
      lastName: user.lastName,
      timezone: "UTC",
    }),
  ]);
  const snapshotOptions = snapshots.map((snapshot) => ({
    ...snapshot,
    isFavorite: snapshotFavoriteKeys.has(
      getSnapshotFavoriteKey(snapshot.ownerUserId, snapshot.name),
    ),
  }));
  const operations = await Promise.all(
    schedules.map((schedule) => schedule.lastOperationId
      ? getCatalogOperation(user.id, schedule.lastOperationId)
      : null),
  );
  const destinationById = new Map(destinations.map((environment) => [environment.id, environment]));
  const rows = schedules.map((schedule, index) => {
    const environment = destinationById.get(schedule.environmentId);
    const channel = environment?.channels.find((candidate) => candidate.id === schedule.channelId);
    return {
      ...schedule,
      environmentName: environment?.name ?? `Environment #${schedule.environmentId}`,
      channelName: channel?.name ?? `Channel #${schedule.channelId}`,
      lastStatus: operations[index]?.status ?? null,
    };
  });

  return (
    <main className="px-5 py-8 sm:px-8 sm:py-12 lg:px-10">
      <div className="mx-auto w-full max-w-[1560px]">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Scheduler</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Catalog automation</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-black/50 dark:text-white/50">
          Keep demo channels fresh overnight, take periodic backups, or schedule independent clear and restore actions. Every run is durable and appears in Operations and Workflows.
        </p>
        {process.env.NODE_ENV === "development" && !profile.localSchedulerEnabled ? (
          <div
            role="status"
            className="mt-6 flex flex-col gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-200">
                Local scheduler disabled
              </p>
              <p className="mt-1 leading-6 text-amber-900/70 dark:text-amber-100/65">
                This development browser is not dispatching due schedules. Saved
                schedules remain unchanged, and the Vercel Cron dispatcher is not
                affected.
              </p>
            </div>
            <Link
              href="/settings#development"
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 font-semibold text-amber-800 transition hover:bg-amber-500/20 dark:text-amber-100"
            >
              Enable in Settings →
            </Link>
          </div>
        ) : null}
        <div className="mt-8">
          <SchedulerWorkspace
            schedules={rows}
            destinations={destinations}
            snapshots={snapshotOptions}
            defaultTimezone={profile.timezone}
          />
        </div>
      </div>
    </main>
  );
}
