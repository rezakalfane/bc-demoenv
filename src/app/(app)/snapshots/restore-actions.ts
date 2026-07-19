"use server";

import { requireAppUser } from "@/lib/auth";
import { createCatalogOperation, getAccessibleCatalogSnapshot } from "@/lib/db";
import {
  getCatalogRestorePreflight,
  type CatalogRestorePreflight,
  type CatalogRestoreResult,
} from "@/lib/catalog-restore";
import { startCatalogOperationWorkflow } from "@/lib/start-catalog-snapshot-workflow";
import {
  parseSnapshotRestoreGroups,
  type SnapshotRestoreGroup,
} from "@/lib/snapshot-configuration";

export type RestoreSnapshotActionState = {
  status: "idle" | "error" | "success";
  message: string;
  result: CatalogRestoreResult | null;
  operationId?: number;
};

export type RestorePreflightActionState = {
  status: "idle" | "error" | "success";
  message: string;
  snapshotId: number | null;
  destinationEnvironmentId: number | null;
  destinationChannelId: number | null;
  restoreGroups: SnapshotRestoreGroup[];
  result: CatalogRestorePreflight | null;
};

function errorState(message: string): RestoreSnapshotActionState {
  return { status: "error", message, result: null };
}

function parseRestoreRequest(formData: FormData) {
  return {
    snapshotId: Number(formData.get("snapshotId")),
    destinationEnvironmentId: Number(formData.get("destinationEnvironmentId")),
    destinationChannelId: Number(formData.get("destinationChannelId")),
    restoreGroups: parseSnapshotRestoreGroups(
      formData.getAll("restoreGroups").map(String),
    ),
  };
}

export async function preflightSnapshotRestore(
  _previousState: RestorePreflightActionState,
  formData: FormData,
): Promise<RestorePreflightActionState> {
  const request = parseRestoreRequest(formData);
  const base = {
    snapshotId: Number.isSafeInteger(request.snapshotId) ? request.snapshotId : null,
    destinationEnvironmentId: Number.isSafeInteger(request.destinationEnvironmentId)
      ? request.destinationEnvironmentId
      : null,
    destinationChannelId: Number.isSafeInteger(request.destinationChannelId)
      ? request.destinationChannelId
      : null,
    restoreGroups: request.restoreGroups,
  };
  try {
    const user = await requireAppUser();
    const result = await getCatalogRestorePreflight({ ...request, userId: user.id });
    return {
      ...base,
      status: result.canRestore ? "success" : "error",
      message: result.canRestore
        ? "Preflight complete. Review the changes before confirming."
        : "Preflight found issues that must be resolved before restoration.",
      result,
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      message: error instanceof Error ? error.message : "Restore preflight failed.",
      result: null,
    };
  }
}

export async function restoreSnapshot(
  _previousState: RestoreSnapshotActionState,
  formData: FormData,
): Promise<RestoreSnapshotActionState> {
  const {
    snapshotId,
    destinationEnvironmentId,
    destinationChannelId,
    restoreGroups,
  } = parseRestoreRequest(formData);
  const confirmation = formData.get("confirmation")?.toString() ?? "";

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
    const preflight = await getCatalogRestorePreflight({
      snapshotId,
      destinationEnvironmentId,
      destinationChannelId,
      restoreGroups,
      userId: user.id,
    });
    if (!preflight.canRestore) {
      return errorState(
        preflight.blockingIssues[0] ?? "Restore preflight did not pass.",
      );
    }
    const operationId = await createCatalogOperation(user.id, { kind: "restore", snapshotId, environmentId: destinationEnvironmentId, channelId: destinationChannelId, payload: { snapshotId, destinationEnvironmentId, destinationChannelId, restoreGroups } });
    await startCatalogOperationWorkflow(user.id, operationId);
    return { status: "success", message: "Durable restore workflow started.", result: null, operationId };
  } catch (error) {
    console.error("Unable to start snapshot restore operation", error);
    return errorState("The restore operation could not be started.");
  }
}
