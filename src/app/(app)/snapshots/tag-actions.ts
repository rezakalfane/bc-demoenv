"use server";

import { revalidatePath } from "next/cache";
import { requireAppUser } from "@/lib/auth";
import {
  addCatalogSnapshotTag,
  removeCatalogSnapshotTag,
} from "@/lib/db";

function isValidSnapshotId(snapshotId: number) {
  return Number.isSafeInteger(snapshotId) && snapshotId > 0;
}

export async function addSnapshotTag(snapshotId: number, tag: string) {
  if (!isValidSnapshotId(snapshotId) || typeof tag !== "string") {
    return { error: "Invalid tag.", tags: [] };
  }
  const user = await requireAppUser();
  const result = await addCatalogSnapshotTag(user.id, snapshotId, tag);
  if (!result.error) {
    revalidatePath("/snapshots");
    revalidatePath(`/snapshots/${snapshotId}`);
  }
  return result;
}

export async function removeSnapshotTag(snapshotId: number, tag: string) {
  if (!isValidSnapshotId(snapshotId) || typeof tag !== "string") {
    return { error: "Invalid tag.", tags: [] };
  }
  const user = await requireAppUser();
  const result = await removeCatalogSnapshotTag(user.id, snapshotId, tag);
  if (!result.error) {
    revalidatePath("/snapshots");
    revalidatePath(`/snapshots/${snapshotId}`);
  }
  return result;
}
