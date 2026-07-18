"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth";
import {
  addCatalogSnapshotEvent,
  getCatalogSnapshot,
  getCatalogSnapshotSummariesByIds,
  removeCatalogSnapshotSeries,
  removeCatalogSnapshotVersion,
} from "@/lib/db";

export async function deleteSnapshotSeries(snapshotId: number, confirmation: string) {
  const user = await requireAppUser();
  const snapshot = await getCatalogSnapshot(user.id, snapshotId);
  if (!snapshot) return { error: "Snapshot not found." };
  if (confirmation !== "DELETE") return { error: "Type DELETE to confirm." };
  await removeCatalogSnapshotSeries(user.id, snapshot.name);
  revalidatePath("/snapshots");
  redirect("/snapshots");
}

export async function deleteSnapshotVersion(snapshotId: number, viewedSnapshotId: number) {
  const user = await requireAppUser();
  const summaries = await getCatalogSnapshotSummariesByIds(user.id, [snapshotId, viewedSnapshotId]);
  const snapshot = summaries.find((candidate) => candidate.id === snapshotId);
  const viewedSnapshot = summaries.find((candidate) => candidate.id === viewedSnapshotId);
  if (!snapshot || !viewedSnapshot || snapshot.name.localeCompare(viewedSnapshot.name, undefined, { sensitivity: "base" }) !== 0) {
    return { error: "Snapshot version not found." };
  }
  if (snapshot.id === viewedSnapshot.id) {
    return { error: "The version currently selected for viewing cannot be deleted." };
  }
  const removed = await removeCatalogSnapshotVersion(user.id, snapshotId);
  if (removed === 0) return { error: "Snapshot version not found." };
  await addCatalogSnapshotEvent(user.id, {
    eventType: "version_deleted",
    snapshotName: snapshot.name,
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.snapshotVersion,
    payload: {
      sourceEnvironmentName: snapshot.sourceEnvironmentName,
      sourceChannelName: snapshot.sourceChannelName,
      categoryCount: snapshot.categoryCount,
      productCount: snapshot.productCount,
      variantCount: snapshot.variantCount,
      imageCount: snapshot.imageCount,
      metafieldCount: snapshot.metafieldCount,
    },
  });
  revalidatePath("/snapshots");
  revalidatePath(`/snapshots/${snapshotId}`);
  return { error: null };
}
