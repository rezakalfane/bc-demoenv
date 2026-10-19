// Client-safe helpers for snapshot image references (no Node imports).
//
// Captured images are kept as local files named by content hash. A snapshot
// image record points at its file with `local_image`; older repaired snapshots
// carry a dead Vercel Blob `blob_url` whose last path segment is the same hash
// file name, so it still resolves to the local copy.
export const LOCAL_IMAGE_PATTERN = /^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/;
export const LOCAL_IMAGE_ROUTE = "/api/snapshot-images/";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isLocalImagePath(value: unknown) {
  const path = text(value);
  return (
    path.startsWith(LOCAL_IMAGE_ROUTE) &&
    LOCAL_IMAGE_PATTERN.test(path.slice(LOCAL_IMAGE_ROUTE.length))
  );
}

function fileNameOf(value: string) {
  try {
    const path = value.startsWith("/") ? value : new URL(value).pathname;
    return path.split("/").pop() ?? "";
  } catch {
    return "";
  }
}

/** Local file name for an image record, a legacy blob URL, or a route path. */
export function localImageFile(image: unknown) {
  if (typeof image === "string") {
    const file = fileNameOf(text(image));
    return LOCAL_IMAGE_PATTERN.test(file) ? file : "";
  }
  const record = (image ?? {}) as Record<string, unknown>;
  for (const candidate of [text(record.local_image), fileNameOf(text(record.blob_url))]) {
    if (LOCAL_IMAGE_PATTERN.test(candidate)) return candidate;
  }
  return "";
}

export function localImagePath(image: unknown) {
  const file = localImageFile(image);
  return file ? `${LOCAL_IMAGE_ROUTE}${file}` : "";
}

/** What to display for a captured image: the local copy, else the source URL. */
export function snapshotImageSrc(image: unknown) {
  const record = (image ?? {}) as Record<string, unknown>;
  return localImagePath(image) || text(record.url_standard) || text(record.url_zoom);
}
