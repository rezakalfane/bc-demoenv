import "server-only";

import {
  CatalogOperationAlreadyActiveError,
  claimCatalogSchedule,
  createCatalogOperation,
  getAccessibleCatalogSnapshot,
  getCatalogSchedule,
  getCatalogSnapshotCaptureKey,
  getDueCatalogSchedules,
  getLatestCatalogSnapshotByName,
  recordCatalogScheduleDispatch,
  type CatalogSchedule,
  type CatalogScheduleFrequency,
} from "@/lib/db";
import { getCatalogRestorePreflight } from "@/lib/catalog-restore";
import { startCatalogOperationWorkflow } from "@/lib/start-catalog-snapshot-workflow";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: WEEKDAYS.indexOf(read("weekday")),
    time: `${read("hour")}:${read("minute")}`,
  };
}

export function validateScheduleTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function calculateNextScheduleRun(input: {
  frequency: CatalogScheduleFrequency;
  localTime: string;
  weekday: number | null;
  timezone: string;
}, after = new Date()) {
  const start = new Date(after);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  const maxMinutes = 8 * 24 * 60;
  for (let minute = 0; minute < maxMinutes; minute += 1) {
    const candidate = new Date(start.getTime() + minute * 60_000);
    const local = localParts(candidate, input.timezone);
    if (
      local.time === input.localTime &&
      (input.frequency === "daily" || local.weekday === input.weekday)
    ) return candidate.toISOString();
  }
  throw new Error("The next scheduled time could not be calculated.");
}

export async function dispatchCatalogSchedule(
  userId: string,
  scheduleId: number,
) {
  const schedule = await getCatalogSchedule(userId, scheduleId);
  if (!schedule) throw new Error("The schedule was not found.");

  let operationId: number | null = null;
  try {
    const commonPayload = {
      destinationEnvironmentId: schedule.environmentId,
      destinationChannelId: schedule.channelId,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      trigger: "schedule",
      originPath: "/scheduler",
    };
    if (schedule.action === "snapshot") {
      const name = schedule.snapshotName?.trim();
      if (!name) throw new Error("This backup schedule has no snapshot name.");
      const latest = await getLatestCatalogSnapshotByName(userId, name);
      operationId = await createCatalogOperation(userId, {
        kind: "snapshot",
        environmentId: schedule.environmentId,
        channelId: schedule.channelId,
        payload: {
          environmentId: schedule.environmentId,
          channelId: schedule.channelId,
          name,
          confirmedSnapshotId: latest?.id,
          ...commonPayload,
        },
        operationKey: getCatalogSnapshotCaptureKey(name),
      });
    } else if (schedule.action === "clear") {
      operationId = await createCatalogOperation(userId, {
        kind: "clear",
        environmentId: schedule.environmentId,
        channelId: schedule.channelId,
        payload: commonPayload,
        operationKey: `channel:${schedule.environmentId}:${schedule.channelId}`,
      });
    } else {
      if (!schedule.snapshotId) throw new Error("Choose a snapshot version.");
      const snapshot = await getAccessibleCatalogSnapshot(userId, schedule.snapshotId);
      if (!snapshot) throw new Error("The scheduled snapshot is no longer available.");
      if (schedule.action === "restore") {
        const preflight = await getCatalogRestorePreflight({
          snapshotId: snapshot.id,
          destinationEnvironmentId: schedule.environmentId,
          destinationChannelId: schedule.channelId,
          restoreGroups: schedule.restoreGroups,
          userId,
        });
        if (!preflight.canRestore) {
          throw new Error(preflight.blockingIssues[0] ?? "Restore preflight failed.");
        }
      }
      operationId = await createCatalogOperation(userId, {
        kind: schedule.action,
        snapshotId: snapshot.id,
        environmentId: schedule.environmentId,
        channelId: schedule.channelId,
        payload: {
          ...commonPayload,
          snapshotId: snapshot.id,
          restoreGroups: schedule.restoreGroups,
        },
        operationKey: `channel:${schedule.environmentId}:${schedule.channelId}`,
      });
    }
    await startCatalogOperationWorkflow(userId, operationId);
    await recordCatalogScheduleDispatch(userId, schedule.id, operationId, null);
    return operationId;
  } catch (error) {
    const message = error instanceof CatalogOperationAlreadyActiveError
      ? "Another scheduled or manual catalog action is already active for this resource."
      : error instanceof Error ? error.message : "The scheduled action could not start.";
    await recordCatalogScheduleDispatch(userId, schedule.id, operationId, message);
    throw new Error(message);
  }
}

export async function dispatchDueCatalogSchedules(now = new Date(), userId?: string) {
  const schedules = await getDueCatalogSchedules(now.toISOString(), userId);
  const results: Array<{ scheduleId: number; operationId: number | null; error: string | null }> = [];
  for (const schedule of schedules) {
    const nextRunAt = calculateNextScheduleRun(schedule, now);
    if (!(await claimCatalogSchedule(schedule, nextRunAt))) continue;
    try {
      const operationId = await dispatchCatalogSchedule(schedule.userId, schedule.id);
      results.push({ scheduleId: schedule.id, operationId, error: null });
    } catch (error) {
      results.push({
        scheduleId: schedule.id,
        operationId: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export function scheduleDescription(schedule: CatalogSchedule) {
  const day = schedule.frequency === "weekly" && schedule.weekday != null
    ? `${WEEKDAYS[schedule.weekday]} `
    : "";
  return `${schedule.frequency === "daily" ? "Daily" : "Weekly"} · ${day}${schedule.localTime} · ${schedule.timezone}`;
}
