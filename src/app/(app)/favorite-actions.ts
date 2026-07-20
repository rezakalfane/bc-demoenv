"use server";

import { revalidatePath } from "next/cache";
import { requireAppUser } from "@/lib/auth";
import {
  getAccessibleCatalogSnapshotSummary,
  getChannelFavoriteKey,
  getEnvironmentFavoriteKey,
  getSnapshotFavoriteKey,
  hasBigCommerceEnvironment,
  toggleFavoriteResource,
} from "@/lib/db";

export type FavoriteTarget =
  | { type: "environment"; environmentId: number }
  | { type: "channel"; environmentId: number; channelId: number }
  | { type: "snapshot"; snapshotId: number };

function isPositiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

export async function toggleFavorite(target: FavoriteTarget) {
  const user = await requireAppUser();

  if (target.type === "snapshot") {
    if (!isPositiveInteger(target.snapshotId)) {
      return { error: "Invalid snapshot.", isFavorite: null };
    }
    const snapshot = await getAccessibleCatalogSnapshotSummary(
      user.id,
      target.snapshotId,
    );
    if (!snapshot) {
      return { error: "Snapshot not found.", isFavorite: null };
    }
    const isFavorite = await toggleFavoriteResource(
      user.id,
      "snapshot",
      getSnapshotFavoriteKey(snapshot.ownerUserId, snapshot.name),
    );
    revalidatePath("/snapshots");
    return { error: null, isFavorite };
  }

  if (
    !isPositiveInteger(target.environmentId) ||
    (target.type === "channel" && !isPositiveInteger(target.channelId))
  ) {
    return { error: "Invalid favorite.", isFavorite: null };
  }

  if (!(await hasBigCommerceEnvironment(user.id, target.environmentId))) {
    return { error: "Environment not found.", isFavorite: null };
  }

  const resourceKey =
    target.type === "environment"
      ? getEnvironmentFavoriteKey(target.environmentId)
      : getChannelFavoriteKey(target.environmentId, target.channelId);
  const isFavorite = await toggleFavoriteResource(
    user.id,
    target.type,
    resourceKey,
  );

  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath(`/environments/${target.environmentId}`);
  return { error: null, isFavorite };
}
