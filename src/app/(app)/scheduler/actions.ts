"use server";

import { revalidatePath } from "next/cache";
import { requireAppUser } from "@/lib/auth";
import {
  deleteCatalogSchedule,
  getAccessibleCatalogSnapshot,
  getCatalogSchedule,
  saveCatalogSchedule,
  setCatalogScheduleEnabled,
  type CatalogScheduleAction,
  type CatalogScheduleFrequency,
} from "@/lib/db";
import {
  calculateNextScheduleRun,
  dispatchCatalogSchedule,
  dispatchDueCatalogSchedules,
  validateScheduleTimezone,
} from "@/lib/catalog-scheduler";
import { parseSnapshotRestoreGroups } from "@/lib/snapshot-configuration";

export type SchedulerActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const ACTIONS = new Set<CatalogScheduleAction>(["snapshot", "restore", "clear", "refresh"]);
const FREQUENCIES = new Set<CatalogScheduleFrequency>(["daily", "weekly"]);

function fail(message: string): SchedulerActionState {
  return { status: "error", message };
}

export async function saveSchedule(
  _previous: SchedulerActionState,
  formData: FormData,
): Promise<SchedulerActionState> {
  try {
    const user = await requireAppUser();
    const id = Number(formData.get("id") || 0);
    const name = String(formData.get("name") ?? "").trim();
    const environmentId = Number(formData.get("environmentId"));
    const channelId = Number(formData.get("channelId"));
    const action = String(formData.get("action")) as CatalogScheduleAction;
    const frequency = String(formData.get("frequency")) as CatalogScheduleFrequency;
    const localTime = String(formData.get("localTime") ?? "");
    const weekday = frequency === "weekly" ? Number(formData.get("weekday")) : null;
    const timezone = String(formData.get("timezone") ?? "").trim();
    const snapshotId = Number(formData.get("snapshotId") || 0) || null;
    const snapshotName = String(formData.get("snapshotName") ?? "").trim() || null;
    const restoreGroups = parseSnapshotRestoreGroups(formData.getAll("restoreGroups").map(String));
    if (!name || name.length > 100) return fail("Enter a schedule name up to 100 characters.");
    if (!Number.isSafeInteger(environmentId) || environmentId < 1) return fail("Choose an environment.");
    if (!Number.isSafeInteger(channelId) || channelId < 1) return fail("Choose a channel.");
    if (!ACTIONS.has(action)) return fail("Choose a valid action.");
    if (!FREQUENCIES.has(frequency)) return fail("Choose a frequency.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) return fail("Choose a valid local time.");
    if (frequency === "weekly" && (weekday === null || !Number.isInteger(weekday) || weekday < 0 || weekday > 6)) return fail("Choose a weekday.");
    if (!validateScheduleTimezone(timezone)) return fail("Choose a valid IANA timezone.");
    if (action === "snapshot" && !snapshotName) return fail("Enter the snapshot series name.");
    if (["restore", "refresh"].includes(action)) {
      if (!snapshotId || !(await getAccessibleCatalogSnapshot(user.id, snapshotId))) {
        return fail("Choose an available snapshot version.");
      }
      if (restoreGroups.length === 0) return fail("Choose at least one section to restore.");
    }
    await saveCatalogSchedule(user.id, {
      id: id || undefined,
      name,
      environmentId,
      channelId,
      action,
      frequency,
      localTime,
      weekday,
      timezone,
      enabled: formData.get("enabled") !== "false",
      snapshotId,
      snapshotName,
      restoreGroups,
      nextRunAt: calculateNextScheduleRun({ frequency, localTime, weekday, timezone }),
    });
    revalidatePath("/scheduler");
    return { status: "success", message: "Schedule saved." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The schedule could not be saved.";
    return fail(message);
  }
}

export async function toggleSchedule(id: number) {
  try {
    const user = await requireAppUser();
    const schedule = await getCatalogSchedule(user.id, id);
    if (!schedule) return { error: "The schedule was not found.", enabled: null };
    const enabled = !schedule.enabled;
    await setCatalogScheduleEnabled(
      user.id,
      id,
      enabled,
      calculateNextScheduleRun(schedule),
    );
    revalidatePath("/scheduler");
    return { error: null, enabled };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "The schedule could not be updated.",
      enabled: null,
    };
  }
}

export async function removeSchedule(id: number) {
  const user = await requireAppUser();
  await deleteCatalogSchedule(user.id, id);
  revalidatePath("/scheduler");
}

export async function runScheduleNow(id: number) {
  const user = await requireAppUser();
  const operationId = await dispatchCatalogSchedule(user.id, id);
  revalidatePath("/scheduler");
  revalidatePath("/operations");
  return operationId;
}

export async function dispatchLocalDueSchedules() {
  if (process.env.NODE_ENV !== "development") return { dispatched: 0 };
  const user = await requireAppUser();
  const results = await dispatchDueCatalogSchedules(new Date(), user.id);
  if (results.length > 0) {
    revalidatePath("/scheduler");
    revalidatePath("/operations");
    revalidatePath("/operations/workflows");
  }
  return { dispatched: results.length };
}
