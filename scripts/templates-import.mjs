// Imports a template pack (see templates-export.mjs) for the signed-in user.
//
//   npm run templates:import -- <pack folder> [--user <clerk user id>] [--replace]
//
// Prerequisites: start the app and open it once, so the database tables exist.
// Snapshots are inserted as the app's user (LOCAL_USER_ID, default "local-user"
// in single-user local mode; otherwise the one signed-in user), images are copied into
// the local images folder (SNAPSHOT_IMAGES_DIR, default ./.snapshot-images).
// Safe to re-run: a snapshot version that already exists is skipped, or
// replaced with --replace. Snapshot content is imported unchanged, so restores
// validate exactly as they did where the pack was made.
import "./load-env.mjs";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const pack = path.resolve(args.find((a) => !a.startsWith("--") && a !== flag("--user")) ?? "template-pack");
const replace = args.includes("--replace");
const imagesDir = path.resolve(process.env.SNAPSHOT_IMAGES_DIR ?? ".snapshot-images");
const dbUrl = process.env.LOCAL_DATABASE_URL ?? "file:local.db";
const FILE_PATTERN = /^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/;

if (!dbUrl.startsWith("file:")) {
  console.error(`Refusing to write to a non-local database: ${dbUrl}`);
  process.exit(1);
}
if (!existsSync(path.join(pack, "manifest.json"))) {
  console.error(`No manifest.json in ${pack}. Unzip the template pack first.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(path.join(pack, "manifest.json"), "utf8"));
if (manifest.format !== 1) { console.error(`Unsupported pack format ${manifest.format}.`); process.exit(1); }

const db = createClient({ url: dbUrl });
const hasTable = (await db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_snapshots'")).rows.length > 0;
if (!hasTable) {
  console.error("The database has no catalog_snapshots table yet. Start the app (npm run dev), sign in once, then run this again.");
  process.exit(1);
}

const localMode = process.env.AUTH_MODE?.trim().toLowerCase() === "local" ||
  (!process.env.AUTH_MODE?.trim() && !(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY));
let userId = flag("--user") ?? (localMode ? process.env.LOCAL_USER_ID?.trim() || "local-user" : undefined);
if (!userId) {
  const users = (await db.execute("SELECT user_id FROM user_profiles")).rows.map((r) => r.user_id);
  if (users.length !== 1) {
    console.error(users.length === 0
      ? "No user found. Sign in to the app once first (or run it in single-user local mode), or pass --user <clerk user id>."
      : `Several users found (${users.join(", ")}). Pass --user <clerk user id>.`);
    process.exit(1);
  }
  userId = users[0];
}

// Images first: a snapshot should never point at files that are not on disk.
mkdirSync(imagesDir, { recursive: true });
let copied = 0, present = 0;
for (const file of manifest.images) {
  if (!FILE_PATTERN.test(file)) throw new Error(`Unexpected image name in pack: ${file}`);
  const target = path.join(imagesDir, file);
  if (existsSync(target)) { present += 1; continue; }
  copyFileSync(path.join(pack, "images", file), target);
  copied += 1;
}
console.log(`Images: ${copied} copied, ${present} already present (${imagesDir})`);

const COLUMNS = [
  "snapshot_version", "format_version", "source_environment_id", "source_environment_name",
  "source_store_hash", "source_channel_id", "source_channel_name", "category_count", "product_count",
  "variant_count", "image_count", "metafield_count", "payload_bytes", "has_translations",
  "created_at", "updated_at", "published_at",
];
let added = 0, replaced = 0, skipped = 0;
for (const snapshot of manifest.snapshots) {
  const existing = (await db.execute({
    sql: "SELECT id FROM catalog_snapshots WHERE user_id = ? AND name = ? AND snapshot_version = ?",
    args: [userId, snapshot.name, snapshot.snapshot_version],
  })).rows[0];
  if (existing && !replace) { skipped += 1; console.log(`skipped (exists): ${snapshot.name} v${snapshot.snapshot_version}`); continue; }

  const payloadJson = readFileSync(path.join(pack, snapshot.file), "utf8");
  // Only one published version per name; keep an existing one if there is one.
  let publishedAt = snapshot.published_at ?? null;
  if (publishedAt) {
    const other = (await db.execute({
      sql: "SELECT id FROM catalog_snapshots WHERE user_id = ? AND name = ? AND published_at IS NOT NULL AND id != ?",
      args: [userId, snapshot.name, existing?.id ?? -1],
    })).rows[0];
    if (other) publishedAt = null;
  }
  const values = COLUMNS.map((c) => (c === "published_at" ? publishedAt : snapshot[c] ?? null));
  const statements = [];
  if (existing) statements.push({ sql: "DELETE FROM catalog_snapshots WHERE id = ?", args: [existing.id] });
  statements.push({
    sql: `INSERT INTO catalog_snapshots (user_id, name, payload_json, ${COLUMNS.join(", ")})
          VALUES (?, ?, ?, ${COLUMNS.map(() => "?").join(", ")})`,
    args: [userId, snapshot.name, payloadJson, ...values],
  });
  await db.batch(statements, "write");
  const id = (await db.execute({
    sql: "SELECT id FROM catalog_snapshots WHERE user_id = ? AND name = ? AND snapshot_version = ?",
    args: [userId, snapshot.name, snapshot.snapshot_version],
  })).rows[0].id;
  if (publishedAt) {
    await db.execute({
      sql: `INSERT INTO catalog_snapshot_events (user_id, event_type, snapshot_name, snapshot_id, snapshot_version, payload_json)
            VALUES (?, 'version_published', ?, ?, ?, ?)`,
      args: [userId, snapshot.name, id, snapshot.snapshot_version, JSON.stringify({
        sourceEnvironmentName: snapshot.source_environment_name, sourceChannelName: snapshot.source_channel_name,
        categoryCount: snapshot.category_count, productCount: snapshot.product_count,
        variantCount: snapshot.variant_count, imageCount: snapshot.image_count,
        metafieldCount: snapshot.metafield_count, payloadBytes: snapshot.payload_bytes,
      })],
    });
  }
  if (existing) replaced += 1; else added += 1;
  console.log(`${existing ? "replaced" : "added"}: ${snapshot.name} v${snapshot.snapshot_version} (${snapshot.product_count} products)`);
}
db.close();
console.log(`\nDone: ${added} added, ${replaced} replaced, ${skipped} skipped, for user ${userId}.`);
