"use server";

import { requireAppUser } from "@/lib/auth";
import {
  setCollectionSharedVisibility,
  setCollectionViewMode,
  type CollectionViewMode,
} from "@/lib/db";

const collectionIdPattern = /^[a-z0-9][a-z0-9:-]{0,119}$/;

function isValidCollectionId(collectionId: string) {
  return collectionIdPattern.test(collectionId);
}

export async function saveCollectionViewMode(
  collectionId: string,
  viewMode: CollectionViewMode,
) {
  const user = await requireAppUser();
  if (!isValidCollectionId(collectionId) || !["cards", "table"].includes(viewMode)) {
    return { error: "Invalid collection preference." };
  }
  await setCollectionViewMode(user.id, collectionId, viewMode);
  return { error: null };
}

export async function saveCollectionSharedVisibility(
  collectionId: string,
  showShared: boolean,
) {
  const user = await requireAppUser();
  if (!isValidCollectionId(collectionId) || typeof showShared !== "boolean") {
    return { error: "Invalid collection preference." };
  }
  await setCollectionSharedVisibility(user.id, collectionId, showShared);
  return { error: null };
}
