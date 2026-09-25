import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth";
import {
  expireStaleSnapshotOperations,
  getCatalogOperation,
  removeCatalogSnapshotCaptureState,
  updateCatalogOperation,
} from "@/lib/db";
import {
  cancelCatalogOperationWorkflow,
  reconcileCatalogOperationWorkflow,
  startCatalogOperationWorkflow,
} from "@/lib/start-catalog-snapshot-workflow";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ operationId: string }> }) {
  const user = await requireAppUser();
  const id = Number((await params).operationId);
  let op = await getCatalogOperation(user.id, id);
  if (!op) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await reconcileCatalogOperationWorkflow(user.id, op);
  await expireStaleSnapshotOperations(user.id);
  op = await getCatalogOperation(user.id, id);
  if (!op) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ id: op.id, kind: op.kind, status: op.status, currentStep: op.currentStep, stepIndex: op.stepIndex, totalSteps: op.totalSteps, stepProgress: op.stepProgress, snapshotId: op.snapshotId, error: op.error, result: op.resultJson ? JSON.parse(op.resultJson) : null });
}

export async function POST(_: Request, { params }: { params: Promise<{ operationId: string }> }) {
  const user = await requireAppUser();
  const id = Number((await params).operationId);
  const op = await getCatalogOperation(user.id, id);
  if (!op) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (op.status !== "queued") return NextResponse.json({ status: op.status });
  await startCatalogOperationWorkflow(user.id, id);
  return NextResponse.json({ status: "running" });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ operationId: string }> }) {
  const user = await requireAppUser();
  const id = Number((await params).operationId);
  const op = await getCatalogOperation(user.id, id);
  if (!op) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await cancelCatalogOperationWorkflow(op);
  await updateCatalogOperation(user.id, id, { status: "cancelled", currentStep: "Cancelled" });
  await removeCatalogSnapshotCaptureState(id);
  return NextResponse.json({ status: "cancelled" });
}
