import "server-only";

import {
  getCatalogOperation,
  updateCatalogOperation,
} from "@/lib/db";
import {
  clearCatalogChannel,
  restoreCatalogSnapshot,
} from "@/lib/catalog-restore";
import { createCatalogSnapshot } from "@/lib/catalog-snapshots";

export async function runCatalogOperation(userId: string, operationId: number) {
  const operation = await getCatalogOperation(userId, operationId);

  if (!operation || operation.status !== "queued") {
    return operation?.status ?? "missing";
  }

  await updateCatalogOperation(userId, operationId, {
    status: "running",
    currentStep: "Starting",
    stepIndex: 0,
    totalSteps: 1,
  });

  const progress = async (currentStep: string, stepIndex = 0, totalSteps = 1) => {
    const latest = await getCatalogOperation(userId, operationId);
    if (latest?.status === "cancelled") {
      throw new Error("Operation cancelled.");
    }
    await updateCatalogOperation(userId, operationId, {
      currentStep,
      stepIndex,
      totalSteps,
    });
  };

  try {
    const payload = JSON.parse(operation.payloadJson) as Record<string, unknown>;
    let result: unknown;

    if (operation.kind === "clear") {
      result = await clearCatalogChannel({
        destinationEnvironmentId: Number(payload.destinationEnvironmentId),
        destinationChannelId: Number(payload.destinationChannelId),
        userId,
        onProgress: progress,
      });
    } else if (operation.kind === "restore") {
      result = await restoreCatalogSnapshot({
        snapshotId: Number(payload.snapshotId),
        destinationEnvironmentId: Number(payload.destinationEnvironmentId),
        destinationChannelId: Number(payload.destinationChannelId),
        userId,
        onProgress: progress,
      });
    } else {
      result = await createCatalogSnapshot({
        environmentId: Number(payload.environmentId),
        channelId: Number(payload.channelId),
        name: String(payload.name),
        confirmedSnapshotId: payload.confirmedSnapshotId
          ? Number(payload.confirmedSnapshotId)
          : undefined,
        userId,
        onProgress: progress,
      });
    }

    const latestBeforeCompletion = await getCatalogOperation(userId, operationId);
    if (latestBeforeCompletion?.status === "cancelled") return "cancelled";
    const resultWarnings = typeof result === "object" && result !== null && "warnings" in result && Array.isArray(result.warnings)
      ? result.warnings as string[]
      : [];
    await updateCatalogOperation(userId, operationId, {
      status: "completed",
      currentStep: resultWarnings.length > 0
        ? `Completed with ${resultWarnings.length} warning${resultWarnings.length === 1 ? "" : "s"}`
        : "Completed",
      stepIndex: 1,
      totalSteps: 1,
      resultJson: JSON.stringify(result),
      ...(operation.kind === "snapshot" && typeof result === "number"
        ? { snapshotId: result }
        : {}),
      error: null,
    });
    return "completed";
  } catch (error) {
    const latest = await getCatalogOperation(userId, operationId);
    if (latest?.status === "cancelled") return "cancelled";
    const message = error instanceof Error ? error.message : "The operation failed.";
    await updateCatalogOperation(userId, operationId, {
      status: "failed",
      currentStep: "Failed",
      error: message,
    });
    return "failed";
  }
}
