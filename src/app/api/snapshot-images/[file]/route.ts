import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { snapshotImagesDir } from "@/lib/snapshot-image-blob";
import { LOCAL_IMAGE_PATTERN } from "@/lib/snapshot-image-src";

// Serves images a local (local dev) capture stored on disk. Public in
// src/proxy.ts so <img>/next/image can fetch it without a session; only
// content-hash file names are accepted.
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const dir = snapshotImagesDir();
  if (!dir || !LOCAL_IMAGE_PATTERN.test(file)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const bytes = await readFile(join(dir, file));
    return new Response(bytes, {
      headers: {
        "Content-Type": CONTENT_TYPES[file.split(".").pop() ?? ""],
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
