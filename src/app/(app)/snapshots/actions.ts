"use server";

import { requireAppUser } from "@/lib/auth";
import {
  CatalogOperationAlreadyActiveError,
  createCatalogOperation,
  getCatalogSnapshotCaptureKey,
  getCatalogSnapshotSummariesByIds,
  getLatestCatalogSnapshotByName,
  normalizeCatalogSnapshotName,
} from "@/lib/db";
import { startCatalogSnapshotWorkflow } from "@/workflows/catalog-snapshot";

export type SnapshotConflict = {
  id: number;
  name: string;
  snapshotVersion: number;
  sourceEnvironmentName: string;
  sourceChannelName: string;
  categoryCount: number;
  productCount: number;
  variantCount: number;
  imageCount: number;
  metafieldCount: number;
  payloadBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type SnapshotActionState = {
  status: "idle" | "error" | "confirmation" | "success";
  message: string;
  conflict: SnapshotConflict | null;
  operationId?: number;
};

function errorState(message: string): SnapshotActionState {
  return { status: "error", message, conflict: null };
}

export async function createSnapshot(
  _previousState: SnapshotActionState,
  formData: FormData,
): Promise<SnapshotActionState> {
  const environmentId = Number(formData.get("environmentId"));
  const channelId = Number(formData.get("channelId"));
  const name = normalizeCatalogSnapshotName(
    formData.get("name")?.toString() ?? "",
  );
  const confirmedSnapshotValue = formData.get("confirmedSnapshotId")
    ?.toString()
    .trim();
  const confirmedSnapshotId = confirmedSnapshotValue
    ? Number(confirmedSnapshotValue)
    : undefined;

  if (!Number.isSafeInteger(environmentId) || environmentId < 1) {
    return errorState("Invalid environment.");
  }

  if (!Number.isSafeInteger(channelId) || channelId < 1) {
    return errorState("Invalid channel.");
  }

  if (!name || name.length > 80) {
    return errorState(
      "Snapshot name must contain between 1 and 80 characters.",
    );
  }

  if (
    confirmedSnapshotId !== undefined &&
    (!Number.isSafeInteger(confirmedSnapshotId) || confirmedSnapshotId < 1)
  ) {
    return errorState("The snapshot confirmation is invalid. Please try again.");
  }

  try {
    const user = await requireAppUser();
    const existing = await getLatestCatalogSnapshotByName(user.id, name);
    if (existing && confirmedSnapshotId !== existing.id) {
      return {
        status: "confirmation",
        message: `A snapshot named ${existing.name} already exists. Confirm creating its next version.`,
        conflict: {
          id: existing.id,
          name: existing.name,
          snapshotVersion: existing.snapshotVersion,
          sourceEnvironmentName: existing.sourceEnvironmentName,
          sourceChannelName: existing.sourceChannelName,
          categoryCount: existing.categoryCount,
          productCount: existing.productCount,
          variantCount: existing.variantCount,
          imageCount: existing.imageCount,
          metafieldCount: existing.metafieldCount,
          payloadBytes: existing.payloadBytes,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        },
      };
    }
    const operationId = await createCatalogOperation(user.id, {
      kind: "snapshot",
      environmentId,
      channelId,
      payload: { environmentId, channelId, name, confirmedSnapshotId },
      operationKey: getCatalogSnapshotCaptureKey(name),
    });
    await startCatalogSnapshotWorkflow(user.id, operationId);
    return { status: "success", message: "Snapshot capture started in the background.", conflict: null, operationId };
  } catch (error) {
    if (error instanceof CatalogOperationAlreadyActiveError) {
      return errorState(
        `A snapshot capture named ${name} is already in progress. Wait for it to finish or cancel it before trying again.`,
      );
    }
    console.error("Unable to start catalog snapshot operation", error);
    return errorState("The catalog snapshot operation could not be started.");
  }

}

export async function createNextSnapshotVersion(snapshotId: number) {
  if (!Number.isSafeInteger(snapshotId) || snapshotId < 1) {
    return { error: "Invalid snapshot.", operationId: null };
  }

  try {
    const user = await requireAppUser();
    const [selected] = await getCatalogSnapshotSummariesByIds(user.id, [snapshotId]);
    if (!selected) return { error: "Snapshot not found.", operationId: null };

    const latest = await getLatestCatalogSnapshotByName(user.id, selected.name);
    if (!latest) return { error: "The latest snapshot version was not found.", operationId: null };

    const operationId = await createCatalogOperation(user.id, {
      kind: "snapshot",
      environmentId: latest.sourceEnvironmentId,
      channelId: latest.sourceChannelId,
      payload: {
        environmentId: latest.sourceEnvironmentId,
        channelId: latest.sourceChannelId,
        name: latest.name,
        confirmedSnapshotId: latest.id,
      },
      operationKey: getCatalogSnapshotCaptureKey(latest.name),
    });
    await startCatalogSnapshotWorkflow(user.id, operationId);

    return {
      error: null,
      operationId,
      environmentId: latest.sourceEnvironmentId,
      channelId: latest.sourceChannelId,
      nextVersion: latest.snapshotVersion + 1,
    };
  } catch (error) {
    if (error instanceof CatalogOperationAlreadyActiveError) {
      return {
        error:
          "A capture for this snapshot is already in progress. Wait for it to finish or cancel it before trying again.",
        operationId: null,
      };
    }
    console.error("Unable to create the next snapshot version", error);
    return { error: "The new snapshot version could not be started.", operationId: null };
  }
}
