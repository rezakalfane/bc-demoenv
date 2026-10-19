// One-time repair for snapshots whose BigCommerce CDN images were deleted.
//
// Re-sources each image from the vertical's original products.csv (vendor URL
// or local file), stores the bytes in Vercel Blob, and writes `blob_url` into
// the snapshot payload (gallery images, primary image, preview imageUrl).
//
// Operates on the LOCAL database only (LOCAL_DATABASE_URL, default file:local.db);
// push it to Turso afterwards with Settings -> Profile -> Push.
//
//   node scripts/repair-snapshot-images.mjs                 # dry run, all snapshots
//   node scripts/repair-snapshot-images.mjs --apply         # upload + write DB
//   node scripts/repair-snapshot-images.mjs --apply 60 59   # only these snapshot ids
//
// --apply needs BLOB_READ_WRITE_TOKEN (vercel env pull, or the store's token).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { put } from "@vercel/blob";

const WORKSPACES = process.env.WORKSPACES_DIR ?? path.resolve(import.meta.dirname, "../..");
// snapshot id -> vertical folder holding products.csv (and images/ when local)
const VERTICALS = {
  54: "TargetComponents/it-components",
  55: "Greenmill/hvac-distribution",
  56: "Bergfreunde/outdoor-gear",
  57: "NetAPorter/fashion-multibrand",
  58: "Flawless/vape-distribution",
  59: "VWR/vwr-lab-supplies",
  63: "Veloris/batteries-distribution",
};
const CONTENT_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", avif: "image/avif",
};
const MAX_BYTES = 15 * 1024 * 1024;
const CONCURRENCY = 6;
const CACHE_FILE = path.join(tmpdir(), "bc-demoenv-repair-snapshot-images.json");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const requested = args.filter((a) => /^\d+$/.test(a)).map(Number);
const snapshotIds = requested.length ? requested : Object.keys(VERTICALS).map(Number);

if (apply && !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is required with --apply.");
  process.exit(1);
}

// --- CSV (RFC 4180) ---------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// --- matching: BigCommerce renames name.ext to name__NNNNN.ext --------------
const noExt = (name) => name.replace(/\.[A-Za-z0-9]+$/, "");
const sourceStem = (ref) => {
  let base = ref.split("?")[0].split("/").pop() ?? "";
  try { base = decodeURIComponent(base); } catch {}
  return noExt(base).toLowerCase();
};
const exactStem = (imageFile) =>
  noExt(imageFile.split("/").pop() ?? "").replace(/__\d+$/, "").toLowerCase();
// Re-uploaded images chain suffixes (name__1.1__2.1280.1280__3): keep the name.
const looseStem = (imageFile) =>
  noExt(imageFile.split("/").pop() ?? "").replace(/__\d.*$/, "").toLowerCase();

function buildIndex(folder) {
  const dir = path.join(WORKSPACES, folder);
  const exact = new Map(), loose = new Map();
  for (const row of parseCsv(readFileSync(path.join(dir, "products.csv"), "utf8"))) {
    for (const ref of (row.images ?? "").trim().split(/,\s*(?=https?:\/\/|images\/)/)) {
      if (!ref) continue;
      const source = /^https?:/i.test(ref) ? ref : path.join(dir, ref);
      if (!exact.has(sourceStem(ref))) exact.set(sourceStem(ref), source);
      const key = sourceStem(ref).replace(/__\d.*$/, "");
      if (!loose.has(key)) loose.set(key, source);
    }
  }
  return (imageFile) => exact.get(exactStem(imageFile)) ?? loose.get(looseStem(imageFile));
}

// --- bytes -> Blob ----------------------------------------------------------
const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
const saveCache = () => writeFileSync(CACHE_FILE, JSON.stringify(cache));

async function readSource(source) {
  if (!/^https?:/i.test(source)) {
    const ext = source.split(".").pop().toLowerCase();
    return { bytes: readFileSync(source), contentType: CONTENT_TYPES[ext], ext };
  }
  const response = await fetch(source, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = Object.entries(CONTENT_TYPES).find(([, t]) => t === contentType)?.[0];
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType, ext };
}

async function mirror(source) {
  if (cache[source]) return cache[source];
  const { bytes, contentType, ext } = await readSource(source);
  if (!contentType || !ext) throw new Error("not an image");
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error(`bad size ${bytes.length}`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const blob = await put(`snapshot-images/${hash}.${ext}`, bytes, {
    access: "public", contentType, addRandomSuffix: false, allowOverwrite: true,
  });
  cache[source] = blob.url;
  return blob.url;
}

async function mapLimited(items, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// --- main -------------------------------------------------------------------
const dbUrl = process.env.LOCAL_DATABASE_URL ?? "file:local.db";
if (!dbUrl.startsWith("file:")) {
  console.error(`Refusing to run against a non-local database: ${dbUrl}`);
  process.exit(1);
}
if (apply) {
  const backup = `${dbUrl.slice(5)}.before-image-repair-${Date.now()}`;
  copyFileSync(dbUrl.slice(5), backup);
  console.log(`Backed up database to ${backup}`);
}
const db = createClient({ url: dbUrl });

for (const id of snapshotIds) {
  const folder = VERTICALS[id];
  if (!folder) { console.log(`#${id}: no vertical folder mapped, skipped`); continue; }
  const row = (await db.execute({ sql: "SELECT name, payload_json FROM catalog_snapshots WHERE id = ?", args: [id] })).rows[0];
  if (!row) { console.log(`#${id}: not found in database`); continue; }

  const payload = JSON.parse(row.payload_json);
  const lookup = buildIndex(folder);
  const work = [];
  let total = 0;
  for (const product of payload.catalog.products) {
    for (const image of product.data.images ?? []) {
      total += 1;
      if (image.blob_url) continue;
      work.push({ image, source: lookup(image.image_file ?? "") });
    }
  }
  const matched = work.filter((w) => w.source);
  const failures = [];
  if (apply) {
    await mapLimited(matched, async (w) => {
      try { w.image.blob_url = await mirror(w.source); }
      catch (error) { failures.push(`${w.source}: ${error.message}`); }
    });
    saveCache();
    // Primary image and preview card follow the gallery image with the same id.
    const previews = new Map((payload.preview?.products ?? []).map((p) => [p.id, p]));
    for (const product of payload.catalog.products) {
      const data = product.data;
      const gallery = (data.images ?? []).find((i) => i.id === data.primary_image?.id && i.blob_url)
        ?? (data.images ?? []).find((i) => i.is_thumbnail && i.blob_url)
        ?? (data.images ?? []).find((i) => i.blob_url);
      if (!gallery) continue;
      if (data.primary_image) data.primary_image.blob_url = gallery.blob_url;
      const preview = previews.get(data.id);
      if (preview) preview.imageUrl = gallery.blob_url;
    }
    const json = JSON.stringify(payload);
    await db.execute({
      sql: "UPDATE catalog_snapshots SET payload_json = ?, payload_bytes = ? WHERE id = ?",
      args: [json, Buffer.byteLength(json), id],
    });
  }
  console.log(
    `#${id} ${row.name}: ${matched.length}/${work.length} images matched to a source` +
      ` (${total} total)${apply ? `, ${matched.length - failures.length} uploaded, ${failures.length} failed` : " [dry run]"}`,
  );
  for (const f of failures.slice(0, 5)) console.log(`   failed: ${f}`);
}
db.close();
