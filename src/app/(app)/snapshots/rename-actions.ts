"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAppUser } from "@/lib/auth";
import { renameCatalogSnapshotSeries } from "@/lib/db";
import { publishSnapshotRealtimeEvent } from "@/lib/snapshot-realtime";

export async function renameSnapshot(snapshotId: number, requestedName: string) {
  if (!Number.isSafeInteger(snapshotId) || snapshotId < 1) {
    return { error: "Invalid snapshot.", name: null };
  }

  const user = await requireAppUser();
  let result;
  try {
    result = await renameCatalogSnapshotSeries(user.id, snapshotId, requestedName);
  } catch (error) {
    console.error("Unable to rename snapshot", error);
    return { error: "The snapshot could not be renamed. Try again.", name: null };
  }
  if (result.error) return { error: result.error, name: null };

  revalidatePath("/snapshots");
  for (const versionId of result.snapshotIds) {
    revalidatePath(`/snapshots/${versionId}`);
  }

  if (result.published) {
    after(() => publishSnapshotRealtimeEvent({
      type: "snapshot.renamed",
      snapshotId,
      snapshotName: result.name,
      snapshotVersion: 0,
      occurredAt: new Date().toISOString(),
    }));
  }

  return { error: null, name: result.name };
}
