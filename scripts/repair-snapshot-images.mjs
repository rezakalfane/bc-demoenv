// Repairs snapshots whose BigCommerce CDN images were deleted, using local files.
//
// For every Template snapshot in the LOCAL database (or the ids given) it
//   1. migrates legacy Vercel Blob references (`blob_url`) to `local_image`: the
//      Blob file name is the content hash, i.e. the file name in the local folder;
//   2. re-sources images that still have no local copy from the vertical's
//      original products.csv (vendor URL or local file), a { map } file, or the
//      still-live CDN, and stores them in the local images folder;
//   3. points each preview card and primary image at the local copy.
//
// Images live in SNAPSHOT_IMAGES_DIR (default ./.snapshot-images), named
// <sha256>.<ext>, and are served by /api/snapshot-images/<file>.
// Only the LOCAL database is touched (LOCAL_DATABASE_URL, default file:local.db).
//
//   node scripts/repair-snapshot-images.mjs                 # dry run, all snapshots
//   node scripts/repair-snapshot-images.mjs --apply         # download + write DB
//   node scripts/repair-snapshot-images.mjs --apply 60 59   # only these snapshot ids
import "./load-env.mjs";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const WORKSPACES = process.env.WORKSPACES_DIR ?? path.resolve(import.meta.dirname, "../..");
// snapshot id -> vertical folder holding products.csv (and images/ when local),
// or { map } / { cdn } for snapshots re-sourced another way
const VERTICALS = {
  54: "TargetComponents/it-components",
  55: "Greenmill/hvac-distribution",
  56: "Bergfreunde/outdoor-gear",
  57: "NetAPorter/fashion-multibrand",
  58: "Flawless/vape-distribution",
  59: "VWR/vwr-lab-supplies",
  63: "Veloris/batteries-distribution",
  // Hardware Manufacturer: Prime-Line Parts images found by
  // scripts/fetch-primeline-images.py ({image stem: url}).
  60: { map: "/tmp/primeline-image-map.json" },
  // Still-live BigCommerce CDN: copy what is still served before it goes away.
  62: { cdn: true },
  64: { cdn: true },
};
// Hand-picked sources for products no automatic source covers: "<snapshot id>:<sku>".
const EXTRA_SOURCES = {
  "58:ECYOP1POD0.8":
    "https://m2-devbox-vapoholic-co-uk.cfstack.com/media/catalog/product/cache/207e23213cf636ccdef205098cf3c8a3/product_image/99cb431895/p10826-elux_cyberover_p1_replacement_pods_4_pack.jpg",
};
const CONTENT_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", avif: "image/avif",
};
const MAX_BYTES = 15 * 1024 * 1024;
const CONCURRENCY = 6;
const IMAGES_DIR = path.resolve(process.env.SNAPSHOT_IMAGES_DIR ?? ".snapshot-images");
const FILE_PATTERN = /^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const requested = args.filter((a) => /^\d+$/.test(a)).map(Number);

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

function buildIndex(entry) {
  if (entry.cdn) {
    return (_file, image) => image.url_zoom || image.url_standard || image.image_url;
  }
  if (entry.map) {
    const map = JSON.parse(readFileSync(entry.map, "utf8"));
    return (file) => map[exactStem(file)];
  }
  const folder = entry;
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

// --- bytes -> local file ---------------------------------------------------
const known = new Map(); // source -> file name

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
  if (known.has(source)) return known.get(source);
  const { bytes, contentType, ext } = await readSource(source);
  if (!contentType || !ext) throw new Error("not an image");
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error(`bad size ${bytes.length}`);
  const file = `${createHash("sha256").update(bytes).digest("hex")}.${ext === "jpeg" ? "jpg" : ext}`;
  if (!FILE_PATTERN.test(file)) throw new Error(`unsupported type ${ext}`);
  writeFileSync(path.join(IMAGES_DIR, file), bytes);
  known.set(source, file);
  return file;
}

async function mapLimited(items, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

const localFile = (image) => {
  for (const candidate of [image.local_image, String(image.blob_url ?? "").split("/").pop()]) {
    if (FILE_PATTERN.test(candidate ?? "")) return candidate;
  }
  return "";
};
const onDisk = (file) => file && existsSync(path.join(IMAGES_DIR, file));

// --- main -------------------------------------------------------------------
const dbUrl = process.env.LOCAL_DATABASE_URL ?? "file:local.db";
if (!dbUrl.startsWith("file:")) {
  console.error(`Refusing to run against a non-local database: ${dbUrl}`);
  process.exit(1);
}
if (apply) {
  mkdirSync(IMAGES_DIR, { recursive: true });
  const backup = `${dbUrl.slice(5)}.before-image-repair-${Date.now()}`;
  copyFileSync(dbUrl.slice(5), backup);
  console.log(`Backed up database to ${backup}`);
}
const db = createClient({ url: dbUrl });
const ids = requested.length
  ? requested
  : (await db.execute("SELECT id FROM catalog_snapshots WHERE name LIKE 'Template%' ORDER BY id")).rows.map((r) => Number(r.id));

for (const id of ids) {
  const row = (await db.execute({ sql: "SELECT name, payload_json FROM catalog_snapshots WHERE id = ?", args: [id] })).rows[0];
  if (!row) { console.log(`#${id}: not found in database`); continue; }
  const payload = JSON.parse(row.payload_json);
  const products = payload.catalog?.products ?? [];

  // 1. legacy blob_url -> local_image (when the file is on disk)
  let migrated = 0, total = 0;
  const work = [];
  const entry = VERTICALS[id];
  const lookup = entry ? buildIndex(entry) : null;
  for (const product of products) {
    for (const image of product.data.images ?? []) {
      total += 1;
      const file = localFile(image);
      if (onDisk(file)) {
        if (image.blob_url || image.local_image !== file) migrated += 1;
        if (apply) { image.local_image = file; delete image.blob_url; }
        continue;
      }
      // 2. still no local copy: re-source it
      work.push({
        image,
        source: EXTRA_SOURCES[`${id}:${product.data.sku}`] ?? lookup?.(image.image_file ?? "", image),
      });
    }
  }
  const matched = work.filter((w) => w.source);
  const failures = [];
  if (apply) {
    await mapLimited(matched, async (w) => {
      try {
        w.image.local_image = await mirror(w.source);
        delete w.image.blob_url;
      } catch (error) { failures.push(`${w.source}: ${error.message}`); }
    });
    // 3. primary image and preview card follow the gallery image with the same id
    const previews = new Map((payload.preview?.products ?? []).map((p) => [p.id, p]));
    for (const product of products) {
      const data = product.data;
      const withFile = (data.images ?? []).filter((i) => onDisk(localFile(i)));
      const gallery = withFile.find((i) => i.id === data.primary_image?.id)
        ?? withFile.find((i) => i.is_thumbnail) ?? withFile[0];
      if (!gallery) continue;
      if (data.primary_image) { data.primary_image.local_image = localFile(gallery); delete data.primary_image.blob_url; }
      const preview = previews.get(data.id);
      if (preview) preview.imageUrl = `/api/snapshot-images/${localFile(gallery)}`;
    }
    const json = JSON.stringify(payload);
    await db.execute({
      sql: "UPDATE catalog_snapshots SET payload_json = ?, payload_bytes = ? WHERE id = ?",
      args: [json, Buffer.byteLength(json), id],
    });
  }
  const missingSource = work.length - matched.length;
  console.log(
    `#${id} ${row.name}: ${total} images, ${migrated} already local, ${matched.length}/${work.length} re-sourced` +
      (missingSource ? `, ${missingSource} without a source` : "") +
      (apply ? `, ${failures.length} failed` : " [dry run]"),
  );
  for (const f of failures.slice(0, 5)) console.log(`   failed: ${f}`);
}
db.close();
