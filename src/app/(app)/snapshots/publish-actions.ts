"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAppUser } from "@/lib/auth";
import {
  addCatalogSnapshotEvent,
  getCatalogSnapshot,
  getCatalogSnapshotVersionsByName,
  setPublishedCatalogSnapshotVersion,
  type CatalogSnapshotEvent,
  type CatalogSnapshotSummary,
} from "@/lib/db";
import { publishSnapshotRealtimeEvent } from "@/lib/snapshot-realtime";

async function recordPublicationEvent(
  userId: string,
  eventType: Extract<CatalogSnapshotEvent["eventType"], "version_published" | "version_unpublished">,
  snapshot: CatalogSnapshotSummary,
) {
  await addCatalogSnapshotEvent(userId, {
    eventType,
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
      payloadBytes: snapshot.payloadBytes,
    },
  });
}

export async function setSnapshotVersionPublished(
  snapshotId: number,
  published: boolean,
) {
  if (!Number.isSafeInteger(snapshotId) || snapshotId < 1) {
    return { error: "Invalid snapshot version." };
  }

  const user = await requireAppUser();
  const snapshot = await getCatalogSnapshot(user.id, snapshotId);
  if (!snapshot) {
    return { error: "Snapshot version not found." };
  }

  if (published === Boolean(snapshot.publishedAt)) {
    return { error: null };
  }

  const versions = published
    ? await getCatalogSnapshotVersionsByName(user.id, snapshot.name)
    : [];
  const previouslyPublished = versions.find(
    (version) => version.publishedAt && version.id !== snapshot.id,
  );
  const updated = await setPublishedCatalogSnapshotVersion(
    user.id,
    snapshotId,
    published,
  );

  if (!updated) {
    return { error: "Snapshot version not found." };
  }

  if (previouslyPublished) {
    await recordPublicationEvent(user.id, "version_unpublished", previouslyPublished);
  }
  await recordPublicationEvent(
    user.id,
    published ? "version_published" : "version_unpublished",
    snapshot,
  );

  const occurredAt = new Date().toISOString();
  after(async () => {
    if (previouslyPublished) {
      await publishSnapshotRealtimeEvent({
        type: "snapshot.unpublished",
        snapshotId: previouslyPublished.id,
        snapshotName: previouslyPublished.name,
        snapshotVersion: previouslyPublished.snapshotVersion,
        occurredAt,
      });
    }
    await publishSnapshotRealtimeEvent({
      type: published ? "snapshot.published" : "snapshot.unpublished",
      snapshotId: snapshot.id,
      snapshotName: snapshot.name,
      snapshotVersion: snapshot.snapshotVersion,
      occurredAt,
    });
  });

  revalidatePath("/snapshots");
  revalidatePath(`/snapshots/${snapshotId}`);
  if (previouslyPublished) {
    revalidatePath(`/snapshots/${previouslyPublished.id}`);
  }
  return { error: null };
}
