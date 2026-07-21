import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth";
import {
  expireStaleSnapshotOperations,
  getRecentCatalogOperations,
} from "@/lib/db";
import { reconcileCatalogOperationWorkflow } from "@/lib/start-catalog-snapshot-workflow";

export const runtime = "nodejs";

function parseRecord(value: string | null) {
  if (!value) return {} as Record<string, unknown>;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

type FeedManualAction = {
  label: string;
  description: string;
  href: string;
};

function parseManualActions(value: unknown): FeedManualAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const action = item as Record<string, unknown>;
    if (
      typeof action.label !== "string"
      || typeof action.description !== "string"
      || typeof action.href !== "string"
    ) return [];
    try {
      const url = new URL(action.href);
      if (
        url.protocol !== "https:"
        || !/^store-[a-z0-9]+\.mybigcommerce\.com$/i.test(url.hostname)
      ) return [];
    } catch {
      return [];
    }
    return [{
      label: action.label,
      description: action.description,
      href: action.href,
    }];
  });
}

export async function GET() {
  const user = await requireAppUser();
  const initialOperations = await getRecentCatalogOperations(user.id);
  for (const operation of initialOperations) {
    await reconcileCatalogOperationWorkflow(user.id, operation);
  }
  await expireStaleSnapshotOperations(user.id);

  const operations = await getRecentCatalogOperations(user.id);
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    operations: operations.map((operation) => {
      const payload = parseRecord(operation.payloadJson);
      const result = parseRecord(operation.resultJson);
      const manualActions = parseManualActions(result.manualActions);
      return {
        id: operation.id,
        kind: operation.kind,
        status: operation.status,
        environmentId: operation.environmentId,
        channelId: operation.channelId,
        snapshotId: operation.snapshotId,
        snapshotName: typeof result.snapshotName === "string"
          ? result.snapshotName
          : typeof payload.name === "string"
            ? payload.name
            : null,
        snapshotVersion: typeof result.snapshotVersion === "number"
          ? result.snapshotVersion
          : null,
        destinationEnvironmentName: typeof result.destinationEnvironmentName === "string"
          ? result.destinationEnvironmentName
          : operation.kind === "database_sync" && typeof result.destination === "string"
            ? result.destination
          : null,
        destinationChannelName: typeof result.destinationChannelName === "string"
          ? result.destinationChannelName
          : null,
        currentStep: operation.currentStep,
        error: operation.error,
        manualActionCount: manualActions.length,
        manualAction: manualActions[0] ?? null,
        updatedAt: operation.updatedAt,
      };
    }),
  });
}
