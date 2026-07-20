import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth";
import { getCatalogOperation, updateCatalogOperation } from "@/lib/db";
import {
  cancelCatalogOperationWorkflow,
  reconcileCatalogOperationWorkflow,
  retryCatalogOperationWorkflow,
} from "@/lib/start-catalog-snapshot-workflow";

export const runtime = "nodejs";

type WorkflowAction = "refresh" | "cancel" | "retry";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ operationId: string }> },
) {
  const user = await requireAppUser();
  const operationId = Number((await params).operationId);
  if (!Number.isInteger(operationId) || operationId < 1) {
    return NextResponse.json({ error: "Invalid operation ID." }, { status: 400 });
  }
  const operation = await getCatalogOperation(user.id, operationId);
  if (!operation || !operation.workflowRunId) {
    return NextResponse.json({ error: "Workflow run not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null) as { action?: WorkflowAction } | null;
  const action = body?.action;
  if (!action || !["refresh", "cancel", "retry"].includes(action)) {
    return NextResponse.json({ error: "Unsupported workflow action." }, { status: 400 });
  }

  try {
    if (action === "refresh") {
      await reconcileCatalogOperationWorkflow(user.id, operation);
      const refreshed = await getCatalogOperation(user.id, operationId);
      return NextResponse.json({ operationId, status: refreshed?.status ?? operation.status });
    }

    if (action === "cancel") {
      if (!["queued", "running"].includes(operation.status)) {
        return NextResponse.json({ error: "Only active workflows can be cancelled." }, { status: 409 });
      }
      await cancelCatalogOperationWorkflow(operation);
      await updateCatalogOperation(user.id, operationId, {
        status: "cancelled",
        currentStep: "Cancelled",
      });
      return NextResponse.json({ operationId, status: "cancelled" });
    }

    const replacementOperationId = await retryCatalogOperationWorkflow(user.id, operationId);
    return NextResponse.json({
      operationId,
      replacementOperationId,
      status: "running",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The workflow action failed." },
      { status: 500 },
    );
  }
}
