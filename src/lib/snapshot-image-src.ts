// Client-safe helpers for snapshot image references (no Node/Blob imports).
const BLOB_HOST_PATTERN = /\.public\.blob\.vercel-storage\.com$/i;
export const LOCAL_IMAGE_PATTERN = /^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/;
export const LOCAL_IMAGE_ROUTE = "/api/snapshot-images/";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isBlobImageUrl(value: unknown) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && BLOB_HOST_PATTERN.test(url.hostname);
  } catch {
    return false;
  }
}

export function isLocalImagePath(value: unknown) {
  const path = text(value);
  return (
    path.startsWith(LOCAL_IMAGE_ROUTE) &&
    LOCAL_IMAGE_PATTERN.test(path.slice(LOCAL_IMAGE_ROUTE.length))
  );
}

/** The durable Vercel Blob copy of a captured image, if one was stored. */
export function blobImageUrl(image: unknown) {
  const url = text((image as { blob_url?: unknown } | null)?.blob_url);
  return isBlobImageUrl(url) ? url : "";
}

/** Route path of the copy a local (desktop/dev) capture stored on disk. */
export function localImagePath(image: unknown) {
  const file = text((image as { local_image?: unknown } | null)?.local_image);
  return LOCAL_IMAGE_PATTERN.test(file) ? `${LOCAL_IMAGE_ROUTE}${file}` : "";
}

/** What to display for a captured image: durable copy first, source URL last. */
export function snapshotImageSrc(image: unknown) {
  const record = (image ?? {}) as Record<string, unknown>;
  return (
    blobImageUrl(image) ||
    localImagePath(image) ||
    text(record.url_standard) ||
    text(record.url_zoom)
  );
}
