import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LOCAL_IMAGE_PATTERN,
  LOCAL_IMAGE_ROUTE,
  localImageFile,
  localImagePath,
} from "@/lib/snapshot-image-src";

type JsonRecord = Record<string, unknown>;

const FETCH_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MIRROR_CONCURRENCY = 4;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const CONTENT_TYPES = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([type, extension]) => [extension, type]),
);

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Folder holding the local image copies (override with SNAPSHOT_IMAGES_DIR). */
export function snapshotImagesDir() {
  return process.env.SNAPSHOT_IMAGES_DIR || join(process.cwd(), ".snapshot-images");
}

export function localImageExists(file: string) {
  return LOCAL_IMAGE_PATTERN.test(file) && existsSync(join(snapshotImagesDir(), file));
}

/** Stores bytes under a content-hash name, so identical images share one file. */
export async function storeImageBytes(bytes: Buffer, extension: string) {
  const file = `${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
  if (!LOCAL_IMAGE_PATTERN.test(file)) return null;
  const dir = snapshotImagesDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), bytes);
  return file;
}

/**
 * Downloads one image into the local folder. Returns null instead of throwing:
 * a snapshot without a local copy is still a valid snapshot.
 */
export async function mirrorImageBytes(sourceUrl: string) {
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
    return await storeImageBytes(bytes, extension);
  } catch {
    return null;
  }
}

/** The bytes of an image's local copy, for uploading to BigCommerce on restore. */
export async function readLocalImage(image: unknown) {
  const file = localImageFile(image);
  if (!file || !localImageExists(file)) return null;
  try {
    return {
      bytes: await readFile(join(snapshotImagesDir(), file)),
      file,
      contentType: CONTENT_TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

/** Route path of a stored image reference, only when its file is on disk. */
export function localCopyPath(reference: unknown) {
  const file = localImageFile(reference);
  return file && localImageExists(file) ? `${LOCAL_IMAGE_ROUTE}${file}` : "";
}

/**
 * Returns a copy of a captured product where each image points at its local
 * file when that exists, and otherwise falls back to the source CDN URLs.
 */
export function withLocalImageCopies<T extends JsonRecord>(record: T): T {
  const data = asRecord(record.data);
  if (!data) return record;
  const swap = (value: unknown) => {
    const image = asRecord(value);
    if (!image) return value;
    const { blob_url: _legacy, local_image: _local, ...rest } = image;
    void _legacy;
    void _local;
    const file = localImageFile(image);
    return file && localImageExists(file) ? { ...rest, local_image: file } : rest;
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
 * Adds `local_image` to every captured product image (and the primary image)
 * so the snapshot keeps working after the source store deletes its CDN files.
 */
export async function mirrorProductImages(product: JsonRecord) {
  const images = (Array.isArray(product.images) ? product.images : []).flatMap(
    (value) => {
      const image = asRecord(value);
      return image ? [image] : [];
    },
  );
  const primary = asRecord(product.primary_image);
  const targets = [...images, ...(primary ? [primary] : [])].filter(
    (image) => !localImagePath(image) && sourceUrlOf(image),
  );

  // The primary image repeats a gallery image, so mirror each file once.
  const uniqueUrls = [...new Set(targets.map(sourceUrlOf))];
  const mirrored = new Map<string, string>();
  await mapLimited(uniqueUrls, async (sourceUrl) => {
    const file = await mirrorImageBytes(sourceUrl);
    if (file) mirrored.set(sourceUrl, file);
  });

  for (const image of targets) {
    const file = mirrored.get(sourceUrlOf(image));
    if (file) image.local_image = file;
  }
}
