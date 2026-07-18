import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth";
import { getCatalogOperation, updateCatalogOperation } from "@/lib/db";
import { runCatalogOperation } from "@/lib/catalog-operation-runner";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ operationId: string }> }) {
  const user = await requireAppUser();
  const id = Number((await params).operationId);
  const op = await getCatalogOperation(user.id, id);
  if (!op) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ id: op.id, kind: op.kind, status: op.status, currentStep: op.currentStep, stepIndex: op.stepIndex, totalSteps: op.totalSteps, snapshotId: op.snapshotId, error: op.error, result: op.resultJson ? JSON.parse(op.resultJson) : null });
}

export async function POST(_: Request, { params }: { params: Promise<{ operationId: string }> }) {
  const user = await requireAppUser();
  const id = Number((await params).operationId);
  const op = await getCatalogOperation(user.id, id);
  if (!op) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (op.status !== "queued") return NextResponse.json({ status: op.status });
  const status = await runCatalogOperation(user.id, id);
  return NextResponse.json({ status });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ operationId: string }> }) {
  const user = await requireAppUser();
  const id = Number((await params).operationId);
  await updateCatalogOperation(user.id, id, { status: "cancelled", currentStep: "Cancelled" });
  return NextResponse.json({ status: "cancelled" });
}
