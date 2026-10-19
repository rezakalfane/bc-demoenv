// Downloads the Vercel Blob copies of snapshot images into the local images
// folder, so the local dev server shows them offline. Safe to re-run
// (existing files are skipped). Reads the LOCAL database only.
//
//   node scripts/download-snapshot-images.mjs                 # ./.snapshot-images (dev server)
//   node scripts/download-snapshot-images.mjs --dir /some/folder   # then set SNAPSHOT_IMAGES_DIR to it
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const dir = path.resolve(
  dirFlag >= 0 ? args[dirFlag + 1] : process.env.SNAPSHOT_IMAGES_DIR ?? ".snapshot-images",
);
const dbUrl = process.env.LOCAL_DATABASE_URL ?? "file:local.db";
if (!dbUrl.startsWith("file:")) {
  console.error(`Refusing to read a non-local database: ${dbUrl}`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

const db = createClient({ url: dbUrl });
const { rows } = await db.execute("SELECT payload_json FROM catalog_snapshots");
const urls = new Set();
for (const row of rows) {
  for (const product of JSON.parse(row.payload_json).catalog?.products ?? []) {
    for (const image of product.data?.images ?? []) {
      if (typeof image.blob_url === "string" && image.blob_url) urls.add(image.blob_url);
    }
  }
}
db.close();

const todo = [...urls].filter((url) => !existsSync(path.join(dir, path.basename(new URL(url).pathname))));
console.log(`${urls.size} blob images referenced, ${urls.size - todo.length} already in ${dir}, ${todo.length} to download`);

let next = 0, done = 0, failed = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < todo.length) {
    const url = todo[next++];
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      writeFileSync(path.join(dir, path.basename(new URL(url).pathname)), Buffer.from(await response.arrayBuffer()));
      done += 1;
    } catch (error) {
      failed += 1;
      console.log(`failed: ${url} ${error.message}`);
    }
  }
}));
console.log(`Downloaded ${done}, failed ${failed}.`);
