"use server";

import { revalidatePath } from "next/cache";
import { requireAppUser } from "@/lib/auth";
import {
  syncDevelopmentDatabases,
  type DevelopmentDatabaseSyncDirection,
} from "@/lib/development-database-sync";
import {
  saveUserProfile,
  setLocalSchedulerEnabled,
  setLocalSchedulerInterval,
  setCollectionSharedVisibility,
  setCollectionSidebarCollapsed,
  setCollectionViewMode,
  type CollectionViewMode,
} from "@/lib/db";
import { isValidProfileAvatar } from "@/lib/profile-avatar";

export type ProfileActionState = {
  status: "idle" | "success" | "error";
  message: string;
  preferences?: {
    environments: CollectionViewMode;
    channels: CollectionViewMode;
    snapshots: CollectionViewMode;
    settings: CollectionViewMode;
    showSharedSnapshots: boolean;
    sidebarCollapsed: boolean;
  };
};

export type DatabaseSyncActionResult = {
  status: "success" | "error";
  message: string;
  completedAt?: string;
};

async function runDatabaseSync(
  direction: DevelopmentDatabaseSyncDirection,
): Promise<DatabaseSyncActionResult> {
  const user = await requireAppUser();
  try {
    const result = await syncDevelopmentDatabases(direction, user.id);
    revalidatePath("/", "layout");
    return {
      status: "success",
      message: `${direction === "pull" ? "Pulled Turso into local SQLite" : "Pushed local SQLite to Turso"}: ${result.rowCount.toLocaleString("en-US")} rows across ${result.tableCount} tables.${result.skippedRowCount > 0 ? ` Skipped ${result.skippedRowCount.toLocaleString("en-US")} ownerless legacy note${result.skippedRowCount === 1 ? "" : "s"}.` : ""}`,
      completedAt: result.completedAt,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "The database sync failed.",
    };
  }
}

export async function pullTursoIntoLocalDatabase() {
  return runDatabaseSync("pull");
}

export async function pushLocalDatabaseToTurso() {
  return runDatabaseSync("push");
}

export async function updateLocalSchedulerEnabled(enabled: boolean) {
  const user = await requireAppUser();
  if (process.env.NODE_ENV !== "development") {
    return {
      status: "error" as const,
      message: "The local scheduler is available only in development.",
    };
  }

  await setLocalSchedulerEnabled(user.id, enabled);
  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath("/scheduler");
  return {
    status: "success" as const,
    message: enabled
      ? "The local scheduler is enabled. Due schedules use your selected check interval."
      : "The local scheduler is disabled for your account on this dev server.",
  };
}

export async function updateLocalSchedulerInterval(interval: "minute" | "daily") {
  const user = await requireAppUser();
  if (process.env.NODE_ENV !== "development") {
    return {
      status: "error" as const,
      message: "The local scheduler is available only in development.",
    };
  }
  if (interval !== "minute" && interval !== "daily") {
    return { status: "error" as const, message: "Choose a valid scheduler interval." };
  }

  await setLocalSchedulerInterval(user.id, interval);
  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath("/scheduler");
  return {
    status: "success" as const,
    message: interval === "minute"
      ? "The local dispatcher now checks due schedules every minute."
      : "The local dispatcher now checks due schedules once per day.",
  };
}

function isViewMode(value: string): value is CollectionViewMode {
  return value === "cards" || value === "table";
}

function isTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function saveProfileAndPreferences(
  _previous: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireAppUser();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const avatar = String(formData.get("avatar") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const environments = String(formData.get("environmentsView"));
  const channels = String(formData.get("channelsView"));
  const snapshots = String(formData.get("snapshotsView"));
  const settings = String(formData.get("settingsView"));
  const showSharedSnapshots = formData.get("showSharedSnapshots") === "on";
  const sidebarCollapsed = formData.get("sidebarCollapsed") === "on";

  if (firstName.length > 80 || lastName.length > 80) {
    return { status: "error", message: "Names must be 80 characters or fewer." };
  }
  if (!isValidProfileAvatar(avatar)) {
    return { status: "error", message: "Choose a built-in avatar or upload a valid image." };
  }
  if (!timezone || !isTimezone(timezone)) {
    return { status: "error", message: "Enter a valid IANA timezone, such as Europe/Paris." };
  }
  if (!isViewMode(environments) || !isViewMode(channels) || !isViewMode(snapshots) || !isViewMode(settings)) {
    return { status: "error", message: "Choose a valid display mode for every page." };
  }

  await Promise.all([
    saveUserProfile(user.id, { firstName, lastName, avatar, timezone }),
    setCollectionViewMode(user.id, "dashboard-environments", environments),
    setCollectionViewMode(user.id, "environment-channels", channels),
    setCollectionViewMode(user.id, "snapshot-series", snapshots),
    setCollectionViewMode(user.id, "settings-environments", settings),
    setCollectionSharedVisibility(user.id, "snapshot-series", showSharedSnapshots),
    setCollectionSidebarCollapsed(user.id, "app-shell", sidebarCollapsed),
  ]);

  revalidatePath("/settings");
  revalidatePath("/scheduler");
  revalidatePath("/", "layout");
  return {
    status: "success",
    message: "Profile and preferences saved.",
    preferences: {
      environments,
      channels,
      snapshots,
      settings,
      showSharedSnapshots,
      sidebarCollapsed,
    },
  };
}
