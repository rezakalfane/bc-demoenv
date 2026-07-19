"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export const CATALOG_OPERATION_KEY = "bc-demoenv:catalog-operation";
export type CatalogOperationKind = "snapshot" | "restore" | "clear";
export type CatalogOperation = { kind: CatalogOperationKind; environmentId?: number; channelId?: number; snapshotId?: number; steps?: string[]; operationId?: number; originPath?: string };

export function readCatalogOperation(): CatalogOperation | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CATALOG_OPERATION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as CatalogOperation; } catch { return null; }
}

export function startCatalogOperation(operation: CatalogOperation) {
  window.localStorage.setItem(CATALOG_OPERATION_KEY, JSON.stringify(operation));
  window.dispatchEvent(new Event("catalog-operation-change"));
}

export function finishCatalogOperation() {
  window.localStorage.removeItem(CATALOG_OPERATION_KEY);
  window.dispatchEvent(new Event("catalog-operation-change"));
}

export function catalogOperationIsActive() {
  return Boolean(readCatalogOperation());
}

export function useCatalogOperationActive({
  environmentId,
  channelId,
  snapshotId,
}: {
  environmentId?: number;
  channelId?: number;
  snapshotId?: number;
}) {
  const [operation, setOperation] = useState<CatalogOperation | null>(null);

  useEffect(() => {
    const sync = () => setOperation(readCatalogOperation());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("catalog-operation-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("catalog-operation-change", sync);
    };
  }, []);

  return Boolean(
    operation &&
    (environmentId === undefined || operation.environmentId === environmentId) &&
    (channelId === undefined || operation.channelId === channelId) &&
    (snapshotId === undefined || operation.snapshotId === snapshotId),
  );
}

export function CatalogOperationProgress({ redirectToCreatedSnapshot = false, environmentId, channelId, snapshotId, initialOperation, redirectOnCancelTo }: { redirectToCreatedSnapshot?: boolean; environmentId?: number; channelId?: number; snapshotId?: number; initialOperation?: CatalogOperation; redirectOnCancelTo?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [operation, setOperation] = useState<CatalogOperation | null>(initialOperation ?? null);
  const [stepIndex, setStepIndex] = useState(0);
  const [remote, setRemote] = useState<{ status: string; currentStep: string; stepIndex: number; totalSteps: number; snapshotId: number | null; error: string | null } | null>(null);

  useEffect(() => {
    const sync = () => setOperation(readCatalogOperation());
    const existing = readCatalogOperation();
    if (
      initialOperation &&
      (!existing || existing.operationId !== initialOperation.operationId)
    ) {
      startCatalogOperation(initialOperation);
      sync();
    } else {
      sync();
    }
    const initial = readCatalogOperation();
    if (initial && !initial.operationId) finishCatalogOperation();
    window.addEventListener("storage", sync);
    window.addEventListener("catalog-operation-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("catalog-operation-change", sync);
    };
  }, [initialOperation]);

  useEffect(() => {
    if (!operation) return;
    const operationId = operation.operationId;
    const poll = async () => {
      if (!operationId) return;
      const response = await fetch(`/api/catalog-operations/${operationId}`, { cache: "no-store" });
      if (!response.ok) return;
      const next = await response.json() as { status: string; currentStep: string; stepIndex: number; totalSteps: number; snapshotId: number | null; error: string | null };
      setRemote(next);
      if (next.status === "completed") {
        const isAtCaptureOrigin = operation.originPath
          ? pathname === operation.originPath
          : snapshotId !== undefined
            ? operation.snapshotId === snapshotId
            : environmentId !== undefined && channelId !== undefined &&
              operation.environmentId === environmentId &&
              operation.channelId === channelId;
        if (
          redirectToCreatedSnapshot &&
          isAtCaptureOrigin &&
          operation.kind === "snapshot" &&
          next.snapshotId
        ) {
          finishCatalogOperation();
          router.push(`/snapshots/${next.snapshotId}`);
          return;
        }
        router.refresh();
        window.setTimeout(finishCatalogOperation, 4000);
      } else if (next.status === "cancelled") {
        finishCatalogOperation();
        if (redirectOnCancelTo) router.push(redirectOnCancelTo);
        else router.refresh();
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); router.refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [channelId, environmentId, operation, pathname, redirectOnCancelTo, redirectToCreatedSnapshot, router, snapshotId]);

  const isForThisSurface = !operation || (
    (environmentId === undefined || operation.environmentId === environmentId) &&
    (channelId === undefined || operation.channelId === channelId) &&
    (snapshotId === undefined || operation.snapshotId === snapshotId)
  );

  useEffect(() => {
    queueMicrotask(() => setStepIndex(0));
    if (!operation?.steps?.length) return;
    const timer = window.setInterval(() => {
      setStepIndex((current) => Math.min(current + 1, operation.steps!.length - 1));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [operation]);

  if (!operation || !isForThisSurface) return null;
  const labels = {
    snapshot: ["Capturing snapshot", "Categories → products → variants, images, and metadata"],
    restore: ["Restoring snapshot", "Categories → products → variants and images → channel assignments"],
    clear: ["Clearing channel", "Unassigning products → removing channel categories"],
  } as const;
  const [title, detail] = labels[operation.kind];
  const currentStep = remote?.currentStep || operation.steps?.[stepIndex] || detail;
  const progress = remote?.totalSteps
    ? Math.max(4, Math.min(100, Math.round((remote.stepIndex / remote.totalSteps) * 100)))
    : 4;
  const statusLabel = remote?.status === "failed" ? "Failed" : remote?.status === "completed" ? "Complete" : "Working…";
  return <div className="order-last basis-full rounded-2xl border border-emerald-500/25 bg-emerald-500/8 p-3" role="status" aria-live="polite">
    <div className="flex items-center justify-between gap-3 text-xs font-semibold text-emerald-800 dark:text-emerald-200"><span>{title}</span><span>{statusLabel}</span></div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-950/10 dark:bg-white/10"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
    <div className="mt-2 flex items-center justify-between gap-3">
      <p className="text-[11px] text-emerald-900/65 dark:text-emerald-100/65">{remote?.error || currentStep}</p>
      <button type="button" onClick={async () => { if (remote?.status === "failed" || remote?.status === "completed") { finishCatalogOperation(); router.refresh(); return; } if (operation.operationId) await fetch(`/api/catalog-operations/${operation.operationId}`, { method: "DELETE" }); finishCatalogOperation(); if (redirectOnCancelTo) router.push(redirectOnCancelTo); else router.refresh(); }} className="shrink-0 rounded-lg border border-emerald-700/25 px-3 py-1.5 text-[11px] font-semibold text-emerald-900 transition hover:bg-emerald-500/15 dark:border-emerald-300/25 dark:text-emerald-100">{remote?.status === "failed" || remote?.status === "completed" ? "Dismiss" : "Cancel"}</button>
    </div>
  </div>;
}

export function CatalogActivityBadge({ environmentId, channelId, snapshotId }: { environmentId?: number; channelId?: number; snapshotId?: number }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(Boolean(readCatalogOperation()));
    sync();
    window.addEventListener("catalog-operation-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("catalog-operation-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const operation = readCatalogOperation();
  const matches = operation &&
    (environmentId === undefined || operation.environmentId === environmentId) &&
    (channelId === undefined || operation.channelId === channelId) &&
    (snapshotId === undefined || operation.snapshotId === snapshotId);
  return active && matches ? <span title="Catalog operation in progress" aria-label="Catalog operation in progress" className="inline-flex size-2.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgb(52_211_153/15%)]" /> : null;
}
