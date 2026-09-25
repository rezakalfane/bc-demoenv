import {
  clearCatalogStep,
  completeClearOperationStep,
  completeRefreshOperationStep,
  completeRestoreOperationStep,
  failCatalogOperationStep,
  finalizeCatalogRestoreStep,
  initializeCatalogOperationStep,
  prepareCatalogRestoreStep,
  preflightRefreshOperationStep,
  restoreCatalogGroupStep,
  restoreCatalogProductBatchStep,
} from "./catalog-operation-steps";
import type {
  CatalogRestoreResult,
  DurableCatalogProductBatchResult,
} from "@/lib/catalog-restore";
import type { SnapshotRestoreGroup } from "@/lib/snapshot-configuration";

async function restoreGroup(
  userId: string,
  operationId: number,
  restoreGroup: SnapshotRestoreGroup,
  groupIndex: number,
  totalGroups: number,
): Promise<CatalogRestoreResult> {
  if (restoreGroup !== "catalog") {
    return await restoreCatalogGroupStep(
      userId,
      operationId,
      restoreGroup,
      groupIndex,
      totalGroups,
    );
  }

  const plan = await prepareCatalogRestoreStep(userId, operationId, groupIndex, totalGroups);
  const batches: DurableCatalogProductBatchResult[] = [];
  for (let index = 0; index < plan.newProductBatches.length; index += 1) {
    batches.push(await restoreCatalogProductBatchStep(
      userId,
      operationId,
      { categoryMap: plan.categoryMap, existingProducts: plan.existingProducts },
      plan.newProductBatches[index],
      index,
      plan.newProductBatches.length,
      groupIndex,
      totalGroups,
    ));
  }
  return await finalizeCatalogRestoreStep(
    userId,
    operationId,
    plan,
    batches,
    groupIndex,
    totalGroups,
  );
}

export async function catalogOperationWorkflow(
  userId: string,
  operationId: number,
) {
  "use workflow";
  console.info("Starting durable catalog operation workflow", { operationId });

  try {
    const operation = await initializeCatalogOperationStep(userId, operationId);
    if (operation.kind === "clear") {
      const result = await clearCatalogStep(userId, operationId);
      return await completeClearOperationStep(userId, operationId, result);
    }

    if (operation.kind === "refresh") {
      await preflightRefreshOperationStep(userId, operationId);
      const clearResult = await clearCatalogStep(
        userId,
        operationId,
        2,
        operation.restoreGroups.length + 2,
      );
      const restoreResults: CatalogRestoreResult[] = [];
      for (let index = 0; index < operation.restoreGroups.length; index += 1) {
        restoreResults.push(await restoreGroup(
          userId,
          operationId,
          operation.restoreGroups[index],
          index + 3,
          operation.restoreGroups.length + 2,
        ));
      }
      return await completeRefreshOperationStep(
        userId,
        operationId,
        clearResult,
        restoreResults,
      );
    }

    const results: CatalogRestoreResult[] = [];
    for (let index = 0; index < operation.restoreGroups.length; index += 1) {
      results.push(await restoreGroup(
        userId,
        operationId,
        operation.restoreGroups[index],
        index + 1,
        operation.restoreGroups.length,
      ));
    }
    return await completeRestoreOperationStep(userId, operationId, results);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failCatalogOperationStep(userId, operationId, message);
    throw error;
  }
}
