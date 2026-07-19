import {
  clearCatalogStep,
  completeClearOperationStep,
  completeRestoreOperationStep,
  failCatalogOperationStep,
  initializeCatalogOperationStep,
  restoreCatalogGroupStep,
} from "./catalog-operation-steps";
import type { CatalogRestoreResult } from "@/lib/catalog-restore";

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

    const results: CatalogRestoreResult[] = [];
    for (let index = 0; index < operation.restoreGroups.length; index += 1) {
      results.push(await restoreCatalogGroupStep(
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
