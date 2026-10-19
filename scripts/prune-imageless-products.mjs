// Removes products that have no image on disk from Template snapshots.
// These templates are demo data: a product with no picture is worse than none.
//
// Run scripts/repair-snapshot-images.mjs first so every recoverable image is
// already local. Touches the LOCAL database only; recomputes the summary counts.
//
//   node scripts/prune-imageless-products.mjs                 # dry run, Template snapshots
//   node scripts/prune-imageless-products.mjs --apply [ids]   # write (backs up local.db first)
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const IMAGES_DIR = path.resolve(process.env.SNAPSHOT_IMAGES_DIR ?? ".snapshot-images");
const FILE_PATTERN = /^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const requested = args.filter((a) => /^\d+$/.test(a)).map(Number);

const dbUrl = process.env.LOCAL_DATABASE_URL ?? "file:local.db";
if (!dbUrl.startsWith("file:")) {
  console.error(`Refusing to run against a non-local database: ${dbUrl}`);
  process.exit(1);
}
if (apply) {
  const backup = `${dbUrl.slice(5)}.before-prune-${Date.now()}`;
  copyFileSync(dbUrl.slice(5), backup);
  console.log(`Backed up database to ${backup}`);
}
const db = createClient({ url: dbUrl });
const ids = requested.length
  ? requested
  : (await db.execute("SELECT id FROM catalog_snapshots WHERE name LIKE 'Template%' ORDER BY id")).rows.map((r) => Number(r.id));

const hasLocalImage = (data) =>
  (data.images ?? []).some((i) => FILE_PATTERN.test(i.local_image ?? "") && existsSync(path.join(IMAGES_DIR, i.local_image)));

for (const id of ids) {
  const row = (await db.execute({ sql: "SELECT name, payload_json FROM catalog_snapshots WHERE id = ?", args: [id] })).rows[0];
  if (!row) continue;
  const payload = JSON.parse(row.payload_json);
  const kept = [], removed = [];
  for (const product of payload.catalog.products) (hasLocalImage(product.data) ? kept : removed).push(product);
  console.log(`#${id} ${row.name}: ${removed.length} of ${payload.catalog.products.length} products have no image`);
  for (const p of removed) console.log(`   - ${p.data.id} ${p.data.sku || "(no sku)"} ${p.data.name}`);
  if (!apply || removed.length === 0) continue;

  const gone = new Set(removed.map((p) => p.data.id));
  payload.catalog.products = kept;
  if (payload.preview?.products) payload.preview.products = payload.preview.products.filter((p) => !gone.has(p.id));
  let variants = 0, images = 0, metafields = 0;
  for (const p of kept) {
    variants += p.data.variants?.length ?? 0;
    images += p.data.images?.length ?? 0;
    metafields += (p.metafields?.length ?? 0) + (p.variantMetafields ?? []).reduce((t, v) => t + v.data.length, 0);
  }
  const json = JSON.stringify(payload);
  await db.execute({
    sql: `UPDATE catalog_snapshots SET payload_json = ?, payload_bytes = ?, product_count = ?,
          variant_count = ?, image_count = ?, metafield_count = ? WHERE id = ?`,
    args: [json, Buffer.byteLength(json), kept.length, variants, images, metafields, id],
  });
  console.log(`   -> ${kept.length} products, ${variants} variants, ${images} images`);
}
db.close();
