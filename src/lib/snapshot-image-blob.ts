import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { put } from "@vercel/blob";
import {
  blobImageUrl,
  localImagePath,
  LOCAL_IMAGE_PATTERN,
  LOCAL_IMAGE_ROUTE,
} from "@/lib/snapshot-image-src";

export { blobImageUrl, isBlobImageUrl } from "@/lib/snapshot-image-src";

type JsonRecord = Record<string, unknown>;

const FETCH_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MIRROR_CONCURRENCY = 4;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type StoredImage = { field: "blob_url" | "local_image"; value: string };

/** Where captured image bytes go: Blob when deployed, a local folder when run locally. */
export function snapshotImagesDir() {
  const configured = process.env.SNAPSHOT_IMAGES_DIR;
  if (configured) return configured;
  return process.env.NODE_ENV === "development"
    ? join(process.cwd(), ".snapshot-images")
    : null;
}

export function snapshotImageMirroringEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || snapshotImagesDir());
}

/**
 * Stores image bytes under a content-hash name, so identical images share one
 * copy across snapshots and versions. Returns null instead of throwing: a
 * snapshot without a durable copy is still a valid snapshot.
 */
export async function mirrorImageBytes(
  sourceUrl: string,
): Promise<StoredImage | null> {
  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const extension = EXTENSIONS[contentType];
    if (!extension) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    return await storeImageBytes(bytes, contentType, extension);
  } catch {
    return null;
  }
}

export async function storeImageBytes(
  bytes: Buffer,
  contentType: string,
  extension: string,
): Promise<StoredImage | null> {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`snapshot-images/${hash}.${extension}`, bytes, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { field: "blob_url", value: blob.url };
  }
  const dir = snapshotImagesDir();
  const file = `${hash}.${extension}`;
  // The local route only serves formats that skip the auth middleware matcher.
  if (!dir || !LOCAL_IMAGE_PATTERN.test(file)) return null;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), bytes);
  return { field: "local_image", value: file };
}

/**
 * In local mode (local dev server), a Blob image whose bytes were
 * downloaded to the local folder is served from disk, so snapshots keep their
 * images offline. Blob file names are the content hash, i.e. the local name.
 */
export function localCopyPath(blobUrl: unknown) {
  const dir = snapshotImagesDir();
  if (!dir || !blobImageUrl({ blob_url: blobUrl })) return "";
  const file = basename(new URL(String(blobUrl)).pathname);
  return LOCAL_IMAGE_PATTERN.test(file) && existsSync(join(dir, file))
    ? `${LOCAL_IMAGE_ROUTE}${file}`
    : "";
}

/** Returns a copy of a captured product with Blob images swapped for local files. */
export function withLocalImageCopies<T extends JsonRecord>(record: T): T {
  if (!snapshotImagesDir()) return record;
  const data = asRecord(record.data);
  if (!data) return record;
  const swap = (value: unknown) => {
    const image = asRecord(value);
    const local = image ? localCopyPath(image.blob_url) : "";
    return image && local
      ? { ...image, blob_url: "", local_image: basename(local) }
      : value;
  };
  return {
    ...record,
    data: {
      ...data,
      images: Array.isArray(data.images) ? data.images.map(swap) : data.images,
      primary_image: swap(data.primary_image),
    },
  };
}

function sourceUrlOf(image: JsonRecord) {
  // Largest rendition first: restores re-upload this file to BigCommerce.
  return (
    readString(image.url_zoom) ||
    readString(image.url_standard) ||
    readString(image.image_url) ||
    readString(image.url_thumbnail)
  );
}

async function mapLimited<T>(items: T[], mapper: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += MIRROR_CONCURRENCY) {
    await Promise.all(items.slice(index, index + MIRROR_CONCURRENCY).map(mapper));
  }
}

/**
 * Adds `blob_url` to every captured product image (and the primary image) so
 * the snapshot keeps working after the source store deletes its CDN files.
 * No-op when Blob is not configured.
 */
export async function mirrorProductImages(product: JsonRecord) {
  if (!snapshotImageMirroringEnabled()) return;

  const images = (Array.isArray(product.images) ? product.images : []).flatMap(
    (value) => {
      const image = asRecord(value);
      return image ? [image] : [];
    },
  );
  const primary = asRecord(product.primary_image);
  const targets = [...images, ...(primary ? [primary] : [])].filter(
    (image) =>
      !blobImageUrl(image) && !localImagePath(image) && sourceUrlOf(image),
  );

  // The primary image repeats a gallery image, so mirror each file once.
  const uniqueUrls = [...new Set(targets.map(sourceUrlOf))];
  const mirrored = new Map<string, StoredImage>();
  await mapLimited(uniqueUrls, async (sourceUrl) => {
    const stored = await mirrorImageBytes(sourceUrl);
    if (stored) mirrored.set(sourceUrl, stored);
  });

  for (const image of targets) {
    const stored = mirrored.get(sourceUrlOf(image));
    if (stored) image[stored.field] = stored.value;
  }
}
