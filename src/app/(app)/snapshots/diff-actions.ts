"use server";

import { requireAppUser } from "@/lib/auth";
import { diffCatalogSnapshotManifests, type CatalogSnapshotDiff } from "@/lib/catalog-snapshot-diff";
import { getAccessibleCatalogSnapshot } from "@/lib/db";

type DiffActionResult = { data: CatalogSnapshotDiff | null; error: string | null };

function parseManifest(payloadJson: string) {
  const value: unknown = JSON.parse(payloadJson);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function compareSnapshotVersions(
  fromSnapshotId: number,
  toSnapshotId: number,
): Promise<DiffActionResult> {
  const user = await requireAppUser();
  if (
    !Number.isSafeInteger(fromSnapshotId) || fromSnapshotId < 1 ||
    !Number.isSafeInteger(toSnapshotId) || toSnapshotId < 1 ||
    fromSnapshotId === toSnapshotId
  ) {
    return { data: null, error: "Choose two different snapshot versions." };
  }

  const [from, to] = await Promise.all([
    getAccessibleCatalogSnapshot(user.id, fromSnapshotId),
    getAccessibleCatalogSnapshot(user.id, toSnapshotId),
  ]);
  if (!from || !to) return { data: null, error: "One of these versions is no longer accessible." };
  if (from.ownerUserId !== to.ownerUserId || from.name.localeCompare(to.name, undefined, { sensitivity: "base" }) !== 0) {
    return { data: null, error: "Only versions from the same snapshot series can be compared." };
  }

  try {
    const fromManifest = parseManifest(from.payloadJson);
    const toManifest = parseManifest(to.payloadJson);
    if (!fromManifest || !toManifest) throw new Error("Invalid manifest");
    return {
      data: diffCatalogSnapshotManifests({
        from: { id: from.id, version: from.snapshotVersion, createdAt: from.createdAt, manifest: fromManifest },
        to: { id: to.id, version: to.snapshotVersion, createdAt: to.createdAt, manifest: toManifest },
      }),
      error: null,
    };
  } catch {
    return { data: null, error: "The selected snapshot manifest could not be compared." };
  }
}
