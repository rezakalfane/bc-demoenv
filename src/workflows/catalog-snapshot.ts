import {
  captureCategoryBatchStep,
  captureProductBatchStep,
  completeSnapshotInitializationStep,
  failSnapshotStep,
  finalizeSnapshotStep,
  initializeSnapshotStep,
} from "./catalog-snapshot-steps";

export async function catalogSnapshotWorkflow(
  userId: string,
  operationId: number,
) {
  "use workflow";
  console.info("Starting durable snapshot workflow", { operationId });

  try {
    let categoryProgress = await initializeSnapshotStep(userId, operationId);
    while (
      categoryProgress.nextCategoryIndex < categoryProgress.totalCategories
    ) {
      categoryProgress = await captureCategoryBatchStep(userId, operationId);
    }
    let progress = await completeSnapshotInitializationStep(
      userId,
      operationId,
    );
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
