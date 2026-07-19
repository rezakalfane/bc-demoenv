"use server";

import { requireAppUser } from "@/lib/auth";
import { createCatalogOperation, getAccessibleCatalogSnapshot } from "@/lib/db";
import type { CatalogRestoreResult } from "@/lib/catalog-restore";
import { runCatalogOperation } from "@/lib/catalog-operation-runner";
import { after } from "next/server";
import { parseSnapshotRestoreGroups } from "@/lib/snapshot-configuration";

export type RestoreSnapshotActionState = {
  status: "idle" | "error" | "success";
  message: string;
  result: CatalogRestoreResult | null;
  operationId?: number;
};

function errorState(message: string): RestoreSnapshotActionState {
  return { status: "error", message, result: null };
}

export async function restoreSnapshot(
  _previousState: RestoreSnapshotActionState,
  formData: FormData,
): Promise<RestoreSnapshotActionState> {
  const snapshotId = Number(formData.get("snapshotId"));
  const destinationEnvironmentId = Number(
    formData.get("destinationEnvironmentId"),
  );
  const destinationChannelId = Number(formData.get("destinationChannelId"));
  const confirmation = formData.get("confirmation")?.toString() ?? "";
  const restoreGroups = parseSnapshotRestoreGroups(
    formData.getAll("restoreGroups").map(String),
  );

  if (!Number.isSafeInteger(snapshotId) || snapshotId < 1) {
    return errorState("The snapshot is invalid.");
  }

  if (
    !Number.isSafeInteger(destinationEnvironmentId) ||
    destinationEnvironmentId < 1
  ) {
    return errorState("Choose a destination environment.");
  }

  if (
    !Number.isSafeInteger(destinationChannelId) ||
    destinationChannelId < 1
  ) {
    return errorState("Choose a destination channel.");
  }

  if (confirmation !== "RESTORE") {
    return errorState("Type RESTORE to confirm the catalog replacement.");
  }
  if (restoreGroups.length === 0) {
    return errorState("Choose at least one snapshot section to restore.");
  }

  try {
    const user = await requireAppUser();
    const snapshot = await getAccessibleCatalogSnapshot(user.id, snapshotId);
    if (!snapshot) {
      return errorState("The snapshot is no longer published or is unavailable.");
    }
    const operationId = await createCatalogOperation(user.id, { kind: "restore", snapshotId, environmentId: destinationEnvironmentId, channelId: destinationChannelId, payload: { snapshotId, destinationEnvironmentId, destinationChannelId, restoreGroups } });
    after(async () => {
      await runCatalogOperation(user.id, operationId);
    });
    return { status: "success", message: "Restore started in the background.", result: null, operationId };
  } catch (error) {
    console.error("Unable to start snapshot restore operation", error);
    return errorState("The restore operation could not be started.");
  }
}
