import { FatalError } from "workflow";
import {
  captureWorkflowCatalogSnapshotProductBatch,
  failWorkflowCatalogSnapshot,
  finalizeWorkflowCatalogSnapshot,
  initializeWorkflowCatalogSnapshot,
} from "@/lib/catalog-snapshots";

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

export async function initializeSnapshotStep(
  userId: string,
  operationId: number,
) {
  "use step";
  console.info("Initializing durable snapshot capture", { operationId });
  try {
    return await initializeWorkflowCatalogSnapshot(userId, operationId);
  } catch (error) {
    throw asStepError(error);
  }
}
initializeSnapshotStep.maxRetries = 2;

export async function captureProductBatchStep(
  userId: string,
  operationId: number,
) {
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

export async function finalizeSnapshotStep(
  userId: string,
  operationId: number,
) {
  "use step";
  console.info("Finalizing durable snapshot capture", { operationId });
  try {
    return await finalizeWorkflowCatalogSnapshot(userId, operationId);
  } catch (error) {
    throw asStepError(error);
  }
}
finalizeSnapshotStep.maxRetries = 2;

export async function failSnapshotStep(
  userId: string,
  operationId: number,
  message: string,
) {
  "use step";
  console.error("Durable snapshot capture failed", { operationId, message });
  await failWorkflowCatalogSnapshot(userId, operationId, message);
}
failSnapshotStep.maxRetries = 2;
