// Exports the Template snapshots and their images as a portable "template pack".
//
//   npm run templates:export -- [--out template-pack] [--user <clerk user id>] [--zip]
//
// Reads the LOCAL database (LOCAL_DATABASE_URL, default file:local.db) and the
// local images folder (SNAPSHOT_IMAGES_DIR, default ./.snapshot-images).
// Exports the latest version of every snapshot whose name starts with "Template".
// The pack contains no credentials and no user IDs; import it with
// `npm run templates:import`.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const out = path.resolve(flag("--out") ?? "template-pack");
const imagesDir = path.resolve(process.env.SNAPSHOT_IMAGES_DIR ?? ".snapshot-images");
const dbUrl = process.env.LOCAL_DATABASE_URL ?? "file:local.db";
if (!dbUrl.startsWith("file:")) {
  console.error(`Refusing to read a non-local database: ${dbUrl}`);
  process.exit(1);
}
const FILE_PATTERN = /^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/;

const db = createClient({ url: dbUrl });
const owners = (await db.execute(
  "SELECT user_id, COUNT(*) AS n FROM catalog_snapshots WHERE name LIKE 'Template%' GROUP BY user_id ORDER BY n DESC",
)).rows;
if (owners.length === 0) { console.error("No Template snapshots found."); process.exit(1); }
const userId = flag("--user") ?? owners[0].user_id;
if (owners.length > 1 && !flag("--user")) {
  console.log(`Several users own Template snapshots; using ${userId} (the one with the most). Pass --user to choose.`);
}

const rows = (await db.execute({
  sql: `SELECT * FROM catalog_snapshots s
        WHERE user_id = ? AND name LIKE 'Template%'
          AND snapshot_version = (SELECT MAX(snapshot_version) FROM catalog_snapshots
                                  WHERE user_id = s.user_id AND name = s.name)
        ORDER BY name`,
  args: [userId],
})).rows;

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "snapshots"), { recursive: true });
mkdirSync(path.join(out, "images"), { recursive: true });

const files = new Set();
const missing = [];
const snapshots = [];
for (const row of rows) {
  const payload = JSON.parse(row.payload_json);
  let referenced = 0;
  for (const product of payload.catalog?.products ?? []) {
    for (const image of product.data?.images ?? []) {
      if (!FILE_PATTERN.test(image.local_image ?? "")) continue;
      referenced += 1;
      if (existsSync(path.join(imagesDir, image.local_image))) files.add(image.local_image);
      else missing.push(`${row.name}: ${image.local_image}`);
    }
  }
  const slug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = `snapshots/${slug}-v${row.snapshot_version}.json`;
  writeFileSync(path.join(out, file), row.payload_json);
  const { id: _id, user_id: _user, payload_json: _payload, ...columns } = row;
  void _id; void _user; void _payload;
  snapshots.push({ file, ...columns });
  console.log(`${row.name} v${row.snapshot_version}: ${row.product_count} products, ${referenced} images`);
}
for (const file of files) copyFileSync(path.join(imagesDir, file), path.join(out, "images", file));
writeFileSync(
  path.join(out, "manifest.json"),
  JSON.stringify({ format: 1, createdAt: new Date().toISOString(), snapshots, images: [...files] }, null, 2),
);
db.close();

console.log(`\nWrote ${snapshots.length} snapshots and ${files.size} images to ${out}`);
if (missing.length) console.log(`WARNING: ${missing.length} referenced images are missing on disk, e.g. ${missing[0]}`);
if (args.includes("--zip")) {
  const zip = spawnSync("zip", ["-qr", `${out}.zip`, path.basename(out)], { cwd: path.dirname(out), stdio: "inherit" });
  console.log(zip.status === 0 ? `Zipped to ${out}.zip` : "zip is not available; archive the folder yourself.");
}
