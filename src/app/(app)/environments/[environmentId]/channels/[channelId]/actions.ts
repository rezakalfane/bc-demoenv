"use server";

import { requireAppUser } from "@/lib/auth";
import { createCatalogOperation } from "@/lib/db";
import type { ClearCatalogResult } from "@/lib/catalog-restore";
import { startCatalogOperationWorkflow } from "@/lib/start-catalog-snapshot-workflow";

export type ClearCatalogActionState = {
  status: "idle" | "error" | "success";
  message: string;
  result: ClearCatalogResult | null;
  operationId?: number;
};

export async function clearCatalog(
  _previousState: ClearCatalogActionState,
  formData: FormData,
): Promise<ClearCatalogActionState> {
  const environmentId = Number(formData.get("environmentId"));
  const channelId = Number(formData.get("channelId"));
  const confirmation = formData.get("confirmation")?.toString() ?? "";

  if (!Number.isSafeInteger(environmentId) || environmentId < 1) {
    return { status: "error", message: "Invalid environment.", result: null };
  }
  if (!Number.isSafeInteger(channelId) || channelId < 1) {
    return { status: "error", message: "Invalid channel.", result: null };
  }
  if (confirmation !== "CLEAR") {
    return { status: "error", message: "Type CLEAR to confirm.", result: null };
  }

  try {
    const user = await requireAppUser();
    const operationId = await createCatalogOperation(user.id, { kind: "clear", environmentId, channelId, payload: { destinationEnvironmentId: environmentId, destinationChannelId: channelId } });
    await startCatalogOperationWorkflow(user.id, operationId);
    return { status: "success", message: "Durable clear workflow started.", result: null, operationId };
  } catch (error) {
    console.error("Unable to start clear catalog operation", error);
    return {
      status: "error",
      message:
        "The clear operation could not be started.",
      result: null,
    };
  }
}
