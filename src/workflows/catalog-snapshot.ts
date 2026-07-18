import { FatalError } from "workflow";
import { start } from "workflow/api";
import {
  captureWorkflowCatalogSnapshotProductBatch,
  failWorkflowCatalogSnapshot,
  finalizeWorkflowCatalogSnapshot,
  initializeWorkflowCatalogSnapshot,
} from "@/lib/catalog-snapshots";
import { updateCatalogOperation } from "@/lib/db";

function asStepError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /cancelled|no longer active|not found|invalid|confirm that you want/i.test(
      message,
    )
  ) {
    return new FatalError(message);
  }
  return error;
}

async function initializeSnapshotStep(userId: string, operationId: number) {
  "use step";
  console.info("Initializing durable snapshot capture", { operationId });
  try {
    return await initializeWorkflowCatalogSnapshot(userId, operationId);
  } catch (error) {
    throw asStepError(error);
  }
}
initializeSnapshotStep.maxRetries = 2;

async function captureProductBatchStep(userId: string, operationId: number) {
  "use step";
  console.info("Capturing durable snapshot product batch", { operationId });
  try {
    return await captureWorkflowCatalogSnapshotProductBatch(
      userId,
      operationId,
    );
  } catch (error) {
    throw asStepError(error);
  }
}
captureProductBatchStep.maxRetries = 4;

async function finalizeSnapshotStep(userId: string, operationId: number) {
  "use step";
  console.info("Finalizing durable snapshot capture", { operationId });
  try {
    return await finalizeWorkflowCatalogSnapshot(userId, operationId);
  } catch (error) {
    throw asStepError(error);
  }
}
finalizeSnapshotStep.maxRetries = 2;

async function failSnapshotStep(
  userId: string,
  operationId: number,
  message: string,
) {
  "use step";
  console.error("Durable snapshot capture failed", { operationId, message });
  await failWorkflowCatalogSnapshot(userId, operationId, message);
}
failSnapshotStep.maxRetries = 2;

export async function catalogSnapshotWorkflow(
  userId: string,
  operationId: number,
) {
  "use workflow";
  console.info("Starting durable snapshot workflow", { operationId });

  try {
    let progress = await initializeSnapshotStep(userId, operationId);
    while (progress.nextProductIndex < progress.totalProducts) {
      progress = await captureProductBatchStep(userId, operationId);
    }
    const snapshotId = await finalizeSnapshotStep(userId, operationId);
    console.info("Durable snapshot workflow completed", {
      operationId,
      snapshotId,
    });
    return snapshotId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failSnapshotStep(userId, operationId, message);
    throw error;
  }
}

export async function startCatalogSnapshotWorkflow(
  userId: string,
  operationId: number,
) {
  try {
    const run = await start(catalogSnapshotWorkflow, [userId, operationId]);
    await updateCatalogOperation(userId, operationId, {
      workflowRunId: run.runId,
    });
    return run.runId;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "The durable snapshot workflow could not be started.";
    await updateCatalogOperation(userId, operationId, {
      status: "failed",
      currentStep: "Failed",
      error: message,
    });
    throw error;
  }
}
