import "server-only";

import { createClient, type Client } from "@libsql/client";
import { decryptSecret, encryptSecret } from "@/lib/secret-encryption";

export type Note = {
  id: number;
  title: string;
  createdAt: string;
};

export type BigCommerceEnvironment = {
  id: number;
  name: string;
  storeHash: string;
  accessTokenHint: string;
  createdAt: string;
  updatedAt: string;
};

export type BigCommerceEnvironmentInput = {
  name: string;
  storeHash: string;
  accessToken?: string;
};

export type BigCommerceEnvironmentConnection = {
  id: number;
  name: string;
  storeHash: string;
  accessToken: string | null;
};

export type CatalogSnapshotSummary = {
  id: number;
  ownerUserId: string;
  name: string;
  snapshotVersion: number;
  formatVersion: number;
  sourceEnvironmentId: number;
  sourceEnvironmentName: string;
  sourceStoreHash: string;
  sourceChannelId: number;
  sourceChannelName: string;
  categoryCount: number;
  productCount: number;
  variantCount: number;
  imageCount: number;
  metafieldCount: number;
  payloadBytes: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CatalogSnapshotInput = Omit<
  CatalogSnapshotSummary,
  "id" | "ownerUserId" | "snapshotVersion" | "publishedAt" | "createdAt" | "updatedAt"
> & {
  payloadJson: string;
};

export type CatalogSnapshotRecord = CatalogSnapshotSummary & {
  payloadJson: string;
};

export type CatalogSnapshotSeriesSummary = CatalogSnapshotSummary & {
  versionCount: number;
  publishedSnapshotId: number | null;
  publishedVersion: number | null;
  isOwner: boolean;
};

export type CatalogSnapshotEvent = {
  id: number;
  eventType: "version_deleted" | "version_published" | "version_unpublished";
  snapshotName: string;
  snapshotId: number;
  snapshotVersion: number;
  payloadJson: string;
  createdAt: string;
};

export type CatalogOperation = {
  id: number; userId: string; kind: "snapshot" | "restore" | "clear";
  environmentId: number | null; channelId: number | null; snapshotId: number | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  currentStep: string; stepIndex: number; totalSteps: number; payloadJson: string;
  resultJson: string | null; error: string | null; createdAt: string; updatedAt: string;
};

let client: Client | undefined;
let schemaReady: Promise<void> | undefined;

function getClient() {
  if (client) {
    return client;
  }

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url && process.env.VERCEL) {
    throw new Error(
      "TURSO_DATABASE_URL is missing. Connect the Turso Marketplace integration to this Vercel project.",
    );
  }

  client = createClient({
    url: url ?? "file:local.db",
    authToken: authToken || undefined,
  });

  return client;
}

async function ensureSchema() {
  schemaReady ??= (async () => {
    const db = getClient();

    await db.execute(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const columns = await db.execute("PRAGMA table_info(notes)");
    const hasUserId = columns.rows.some((column) => column.name === "user_id");

    if (!hasUserId) {
      await db.execute("ALTER TABLE notes ADD COLUMN user_id TEXT");
    }

    await db.execute(
      "CREATE INDEX IF NOT EXISTS notes_user_id_id_idx ON notes(user_id, id DESC)",
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS bigcommerce_environments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE CHECK(length(name) BETWEEN 1 AND 80),
        store_hash TEXT NOT NULL CHECK(length(store_hash) BETWEEN 3 AND 64),
        access_token_encrypted TEXT NOT NULL,
        access_token_hint TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS bigcommerce_environments_user_name_idx ON bigcommerce_environments(user_id, name)",
    );

    await db.execute(
      "CREATE INDEX IF NOT EXISTS bigcommerce_environments_user_id_idx ON bigcommerce_environments(user_id, id DESC)",
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS catalog_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE CHECK(length(name) BETWEEN 1 AND 80),
        snapshot_version INTEGER NOT NULL DEFAULT 1,
        format_version INTEGER NOT NULL,
        source_environment_id INTEGER NOT NULL,
        source_environment_name TEXT NOT NULL,
        source_store_hash TEXT NOT NULL,
        source_channel_id INTEGER NOT NULL,
        source_channel_name TEXT NOT NULL,
        category_count INTEGER NOT NULL,
        product_count INTEGER NOT NULL,
        variant_count INTEGER NOT NULL,
        image_count INTEGER NOT NULL,
        metafield_count INTEGER NOT NULL,
        payload_bytes INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const snapshotColumns = await db.execute(
      "PRAGMA table_info(catalog_snapshots)",
    );
    const hasSnapshotVersion = snapshotColumns.rows.some(
      (column) => column.name === "snapshot_version",
    );

    if (!hasSnapshotVersion) {
      await db.execute(
        "ALTER TABLE catalog_snapshots ADD COLUMN snapshot_version INTEGER NOT NULL DEFAULT 1",
      );
    }

    const hasPublishedAt = snapshotColumns.rows.some(
      (column) => column.name === "published_at",
    );

    if (!hasPublishedAt) {
      await db.execute(
        "ALTER TABLE catalog_snapshots ADD COLUMN published_at TEXT",
      );
    }

    await db.execute("DROP INDEX IF EXISTS catalog_snapshots_user_name_idx");

    await db.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS catalog_snapshots_user_name_version_idx ON catalog_snapshots(user_id, name, snapshot_version)",
    );

    await db.execute(
      "CREATE INDEX IF NOT EXISTS catalog_snapshots_user_created_idx ON catalog_snapshots(user_id, id DESC)",
    );

    await db.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS catalog_snapshots_one_published_version_idx ON catalog_snapshots(user_id, name COLLATE NOCASE) WHERE published_at IS NOT NULL",
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS catalog_snapshot_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        snapshot_name TEXT NOT NULL COLLATE NOCASE,
        snapshot_id INTEGER NOT NULL,
        snapshot_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(
      "CREATE INDEX IF NOT EXISTS catalog_snapshot_events_user_name_idx ON catalog_snapshot_events(user_id, snapshot_name, id DESC)",
    );

    await db.execute(`CREATE TABLE IF NOT EXISTS catalog_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL,
      environment_id INTEGER, channel_id INTEGER, snapshot_id INTEGER,
      status TEXT NOT NULL DEFAULT 'queued', current_step TEXT NOT NULL DEFAULT '',
      step_index INTEGER NOT NULL DEFAULT 0, total_steps INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL, result_json TEXT, error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.execute("CREATE INDEX IF NOT EXISTS catalog_operations_user_idx ON catalog_operations(user_id, id DESC)");
  })();

  return schemaReady;
}

function toCatalogOperation(row: Record<string, unknown>): CatalogOperation {
  return { id: Number(row.id), userId: String(row.user_id), kind: row.kind as CatalogOperation["kind"], environmentId: row.environment_id == null ? null : Number(row.environment_id), channelId: row.channel_id == null ? null : Number(row.channel_id), snapshotId: row.snapshot_id == null ? null : Number(row.snapshot_id), status: row.status as CatalogOperation["status"], currentStep: String(row.current_step ?? ""), stepIndex: Number(row.step_index ?? 0), totalSteps: Number(row.total_steps ?? 0), payloadJson: String(row.payload_json), resultJson: row.result_json == null ? null : String(row.result_json), error: row.error == null ? null : String(row.error), createdAt: toIsoDate(row.created_at), updatedAt: toIsoDate(row.updated_at) };
}

export async function createCatalogOperation(userId: string, input: { kind: CatalogOperation["kind"]; environmentId?: number; channelId?: number; snapshotId?: number; payload: unknown; totalSteps?: number }) {
  await ensureSchema();
  const r = await getClient().execute({ sql: `INSERT INTO catalog_operations (user_id,kind,environment_id,channel_id,snapshot_id,payload_json,total_steps) VALUES (?,?,?,?,?,?,?) RETURNING id`, args: [userId,input.kind,input.environmentId ?? null,input.channelId ?? null,input.snapshotId ?? null,JSON.stringify(input.payload),input.totalSteps ?? 0] });
  return Number(r.rows[0].id);
}
export async function getCatalogOperation(userId: string, id: number) { await ensureSchema(); const r = await getClient().execute({sql:"SELECT * FROM catalog_operations WHERE user_id = ? AND id = ?",args:[userId,id]}); return r.rows[0] ? toCatalogOperation(r.rows[0] as Record<string,unknown>) : null; }
export async function updateCatalogOperation(userId: string, id: number, patch: Partial<Pick<CatalogOperation,"status"|"currentStep"|"stepIndex"|"totalSteps"|"resultJson"|"error"|"payloadJson"|"snapshotId">>) { await ensureSchema(); const fields: string[]=[]; const args: Array<string | number | null>=[]; for (const [k,v] of Object.entries(patch)) { const col=k.replace(/[A-Z]/g,m=>`_${m.toLowerCase()}`); fields.push(`${col} = ?`); args.push(v ?? null); } if (!fields.length) return; fields.push("updated_at = CURRENT_TIMESTAMP"); args.push(userId,id); await getClient().execute({sql:`UPDATE catalog_operations SET ${fields.join(", ")} WHERE user_id = ? AND id = ?`,args}); }

export async function getCatalogOperationsForChannel(userId: string, environmentId: number, channelId: number) {
  await ensureSchema();
  const result = await getClient().execute({ sql: "SELECT * FROM catalog_operations WHERE user_id = ? AND environment_id = ? AND channel_id = ? ORDER BY id DESC LIMIT 100", args: [userId, environmentId, channelId] });
  return result.rows.map((row) => toCatalogOperation(row as Record<string, unknown>));
}

export async function getCatalogOperationsForSnapshots(userId: string, snapshotIds: number[]) {
  await ensureSchema();
  if (snapshotIds.length === 0) return [];
  const placeholders = snapshotIds.map(() => "?").join(",");
  const result = await getClient().execute({ sql: `SELECT * FROM catalog_operations WHERE user_id = ? AND snapshot_id IN (${placeholders}) ORDER BY id DESC LIMIT 100`, args: [userId, ...snapshotIds] });
  return result.rows.map((row) => toCatalogOperation(row as Record<string, unknown>));
}

export async function getActiveSnapshotOperations(userId: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "SELECT * FROM catalog_operations WHERE user_id = ? AND kind = 'snapshot' AND status IN ('queued', 'running') ORDER BY id DESC",
    args: [userId],
  });
  return result.rows.map((row) => toCatalogOperation(row as Record<string, unknown>));
}

export async function getNotes(userId: string): Promise<Note[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "SELECT id, title, created_at FROM notes WHERE user_id = ? ORDER BY id DESC LIMIT 50",
    args: [userId],
  });

  return result.rows.map((row) => ({
    id: Number(row.id),
    title: String(row.title),
    createdAt: `${String(row.created_at).replace(" ", "T")}Z`,
  }));
}

export async function addNote(userId: string, title: string) {
  await ensureSchema();
  await getClient().execute({
    sql: "INSERT INTO notes (user_id, title) VALUES (?, ?)",
    args: [userId, title],
  });
}

export async function removeNote(userId: string, id: number) {
  await ensureSchema();
  await getClient().execute({
    sql: "DELETE FROM notes WHERE id = ? AND user_id = ?",
    args: [id, userId],
  });
}

function toIsoDate(value: unknown) {
  return `${String(value).replace(" ", "T")}Z`;
}

export async function getBigCommerceEnvironments(
  userId: string,
): Promise<BigCommerceEnvironment[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT id, name, store_hash, access_token_hint, created_at, updated_at
      FROM bigcommerce_environments
      WHERE user_id = ?
      ORDER BY name COLLATE NOCASE ASC, id ASC
    `,
    args: [userId],
  });

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    storeHash: String(row.store_hash),
    accessTokenHint: String(row.access_token_hint),
    createdAt: toIsoDate(row.created_at),
    updatedAt: toIsoDate(row.updated_at),
  }));
}

export async function getBigCommerceEnvironmentConnections(
  userId: string,
): Promise<BigCommerceEnvironmentConnection[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT id, name, store_hash, access_token_encrypted
      FROM bigcommerce_environments
      WHERE user_id = ?
      ORDER BY name COLLATE NOCASE ASC, id ASC
    `,
    args: [userId],
  });

  return result.rows.map((row) => {
    let accessToken: string | null = null;

    try {
      accessToken = decryptSecret(
        String(row.access_token_encrypted),
        userId,
      );
    } catch {
      // Keep one invalid credential from preventing other environments loading.
    }

    return {
      id: Number(row.id),
      name: String(row.name),
      storeHash: String(row.store_hash),
      accessToken,
    };
  });
}

export async function getBigCommerceEnvironmentConnection(
  userId: string,
  id: number,
): Promise<BigCommerceEnvironmentConnection | null> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT id, name, store_hash, access_token_encrypted
      FROM bigcommerce_environments
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    args: [id, userId],
  });
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  let accessToken: string | null = null;

  try {
    accessToken = decryptSecret(String(row.access_token_encrypted), userId);
  } catch {
    // Return the environment without its credential so the page can explain
    // how to repair an invalid or stale encrypted token.
  }

  return {
    id: Number(row.id),
    name: String(row.name),
    storeHash: String(row.store_hash),
    accessToken,
  };
}

export async function addBigCommerceEnvironment(
  userId: string,
  input: BigCommerceEnvironmentInput & { accessToken: string },
) {
  await ensureSchema();
  const encryptedToken = encryptSecret(input.accessToken, userId);

  await getClient().execute({
    sql: `
      INSERT INTO bigcommerce_environments (
        user_id,
        name,
        store_hash,
        access_token_encrypted,
        access_token_hint
      ) VALUES (?, ?, ?, ?, ?)
    `,
    args: [
      userId,
      input.name,
      input.storeHash,
      encryptedToken,
      input.accessToken.slice(-4),
    ],
  });
}

export async function updateBigCommerceEnvironment(
  userId: string,
  id: number,
  input: BigCommerceEnvironmentInput,
) {
  await ensureSchema();

  if (input.accessToken) {
    await getClient().execute({
      sql: `
        UPDATE bigcommerce_environments
        SET name = ?,
            store_hash = ?,
            access_token_encrypted = ?,
            access_token_hint = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      args: [
        input.name,
        input.storeHash,
        encryptSecret(input.accessToken, userId),
        input.accessToken.slice(-4),
        id,
        userId,
      ],
    });
    return;
  }

  await getClient().execute({
    sql: `
      UPDATE bigcommerce_environments
      SET name = ?, store_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    args: [input.name, input.storeHash, id, userId],
  });
}

export async function removeBigCommerceEnvironment(
  userId: string,
  id: number,
) {
  await ensureSchema();
  await getClient().execute({
    sql: "DELETE FROM bigcommerce_environments WHERE id = ? AND user_id = ?",
    args: [id, userId],
  });
}

function toCatalogSnapshotSummary(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    ownerUserId: String(row.user_id),
    name: String(row.name),
    snapshotVersion: Number(row.snapshot_version),
    formatVersion: Number(row.format_version),
    sourceEnvironmentId: Number(row.source_environment_id),
    sourceEnvironmentName: String(row.source_environment_name),
    sourceStoreHash: String(row.source_store_hash),
    sourceChannelId: Number(row.source_channel_id),
    sourceChannelName: String(row.source_channel_name),
    categoryCount: Number(row.category_count),
    productCount: Number(row.product_count),
    variantCount: Number(row.variant_count),
    imageCount: Number(row.image_count),
    metafieldCount: Number(row.metafield_count),
    payloadBytes: Number(row.payload_bytes),
    publishedAt: row.published_at == null ? null : toIsoDate(row.published_at),
    createdAt: toIsoDate(row.created_at),
    updatedAt: toIsoDate(row.updated_at),
  } satisfies CatalogSnapshotSummary;
}

const catalogSnapshotColumns = `
  id,
  user_id,
  name,
  snapshot_version,
  format_version,
  source_environment_id,
  source_environment_name,
  source_store_hash,
  source_channel_id,
  source_channel_name,
  category_count,
  product_count,
  variant_count,
  image_count,
  metafield_count,
  payload_bytes,
  published_at,
  created_at,
  updated_at
`;

export async function getCatalogSnapshots(
  userId: string,
): Promise<CatalogSnapshotSummary[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT ${catalogSnapshotColumns}
      FROM catalog_snapshots
      WHERE user_id = ? OR published_at IS NOT NULL
      ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, id DESC
    `,
    args: [userId, userId],
  });

  return result.rows.map((row) => toCatalogSnapshotSummary(row));
}

export async function getCatalogSnapshotSummariesByIds(
  userId: string,
  ids: number[],
): Promise<CatalogSnapshotSummary[]> {
  await ensureSchema();
  const uniqueIds = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (uniqueIds.length === 0) return [];
  const placeholders = uniqueIds.map(() => "?").join(",");
  const result = await getClient().execute({
    sql: `
      SELECT ${catalogSnapshotColumns}
      FROM catalog_snapshots
      WHERE user_id = ? AND id IN (${placeholders})
    `,
    args: [userId, ...uniqueIds],
  });
  return result.rows.map((row) => toCatalogSnapshotSummary(row));
}

export async function getCatalogSnapshotSeries(
  userId: string,
): Promise<CatalogSnapshotSeriesSummary[]> {
  await ensureSchema();
  const ownedResult = await getClient().execute({
    sql: `
      SELECT ${catalogSnapshotColumns}, version_count, published_snapshot_id, published_version
      FROM (
        SELECT
          ${catalogSnapshotColumns},
          COUNT(*) OVER (
            PARTITION BY name COLLATE NOCASE
          ) AS version_count,
          MAX(CASE WHEN published_at IS NOT NULL THEN id END) OVER (
            PARTITION BY name COLLATE NOCASE
          ) AS published_snapshot_id,
          MAX(CASE WHEN published_at IS NOT NULL THEN snapshot_version END) OVER (
            PARTITION BY name COLLATE NOCASE
          ) AS published_version,
          ROW_NUMBER() OVER (
            PARTITION BY name COLLATE NOCASE
            ORDER BY snapshot_version DESC, id DESC
          ) AS series_rank
        FROM catalog_snapshots
        WHERE user_id = ?
      )
      WHERE series_rank = 1
      ORDER BY id DESC
    `,
    args: [userId],
  });

  const sharedResult = await getClient().execute({
    sql: `
      SELECT ${catalogSnapshotColumns}, 1 AS version_count,
             id AS published_snapshot_id, snapshot_version AS published_version
      FROM catalog_snapshots
      WHERE published_at IS NOT NULL AND user_id <> ?
      ORDER BY published_at DESC, id DESC
    `,
    args: [userId],
  });

  return [...ownedResult.rows, ...sharedResult.rows].map((row) => ({
    ...toCatalogSnapshotSummary(row),
    versionCount: Number(row.version_count),
    publishedSnapshotId: row.published_snapshot_id == null ? null : Number(row.published_snapshot_id),
    publishedVersion: row.published_version == null ? null : Number(row.published_version),
    isOwner: String(row.user_id) === userId,
  })).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export async function getLatestCatalogSnapshotSeries(
  userId: string,
): Promise<CatalogSnapshotSummary[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT ${catalogSnapshotColumns}
      FROM (
        SELECT
          ${catalogSnapshotColumns},
          ROW_NUMBER() OVER (
            PARTITION BY name COLLATE NOCASE
            ORDER BY snapshot_version DESC, id DESC
          ) AS series_rank
        FROM catalog_snapshots
        WHERE user_id = ?
      )
      WHERE series_rank = 1
      ORDER BY name COLLATE NOCASE ASC, id ASC
    `,
    args: [userId],
  });

  return result.rows.map((row) => toCatalogSnapshotSummary(row));
}

export async function getCatalogSnapshot(
  userId: string,
  id: number,
): Promise<CatalogSnapshotRecord | null> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT ${catalogSnapshotColumns}, payload_json
      FROM catalog_snapshots
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    args: [id, userId],
  });
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    ...toCatalogSnapshotSummary(row),
    payloadJson: String(row.payload_json),
  };
}

export async function getAccessibleCatalogSnapshot(
  userId: string,
  id: number,
): Promise<CatalogSnapshotRecord | null> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT ${catalogSnapshotColumns}, payload_json
      FROM catalog_snapshots
      WHERE id = ? AND (user_id = ? OR published_at IS NOT NULL)
      LIMIT 1
    `,
    args: [id, userId],
  });
  const row = result.rows[0];
  return row ? { ...toCatalogSnapshotSummary(row), payloadJson: String(row.payload_json) } : null;
}

export async function setPublishedCatalogSnapshotVersion(
  userId: string,
  id: number,
  publish: boolean,
) {
  await ensureSchema();
  const snapshot = await getCatalogSnapshot(userId, id);
  if (!snapshot) return false;

  if (publish) {
    await getClient().batch([
      {
        sql: "UPDATE catalog_snapshots SET published_at = NULL WHERE user_id = ? AND name = ? COLLATE NOCASE",
        args: [userId, snapshot.name],
      },
      {
        sql: "UPDATE catalog_snapshots SET published_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?",
        args: [userId, id],
      },
    ], "write");
  } else {
    await getClient().execute({
      sql: "UPDATE catalog_snapshots SET published_at = NULL WHERE user_id = ? AND id = ?",
      args: [userId, id],
    });
  }

  return true;
}

export async function getCatalogSnapshotVersionsByName(
  userId: string,
  name: string,
): Promise<CatalogSnapshotSummary[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT ${catalogSnapshotColumns}
      FROM catalog_snapshots
      WHERE user_id = ? AND name = ? COLLATE NOCASE
      ORDER BY snapshot_version DESC, id DESC
    `,
    args: [userId, name],
  });

  return result.rows.map((row) => toCatalogSnapshotSummary(row));
}

export async function getLatestCatalogSnapshotByName(
  userId: string,
  name: string,
): Promise<CatalogSnapshotSummary | null> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT ${catalogSnapshotColumns}
      FROM catalog_snapshots
      WHERE user_id = ? AND name = ? COLLATE NOCASE
      ORDER BY snapshot_version DESC, id DESC
      LIMIT 1
    `,
    args: [userId, name],
  });
  const row = result.rows[0];

  return row ? toCatalogSnapshotSummary(row) : null;
}

export async function addCatalogSnapshot(
  userId: string,
  input: CatalogSnapshotInput,
) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      INSERT INTO catalog_snapshots (
        user_id,
        name,
        snapshot_version,
        format_version,
        source_environment_id,
        source_environment_name,
        source_store_hash,
        source_channel_id,
        source_channel_name,
        category_count,
        product_count,
        variant_count,
        image_count,
        metafield_count,
        payload_bytes,
        payload_json
      )
      SELECT
        ?,
        ?,
        COALESCE(MAX(version_number), 0) + 1,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      FROM (
        SELECT snapshot_version AS version_number
        FROM catalog_snapshots
        WHERE user_id = ? AND name = ? COLLATE NOCASE
        UNION ALL
        SELECT snapshot_version AS version_number
        FROM catalog_snapshot_events
        WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE
      )
      RETURNING id, snapshot_version
    `,
    args: [
      userId,
      input.name,
      input.formatVersion,
      input.sourceEnvironmentId,
      input.sourceEnvironmentName,
      input.sourceStoreHash,
      input.sourceChannelId,
      input.sourceChannelName,
      input.categoryCount,
      input.productCount,
      input.variantCount,
      input.imageCount,
      input.metafieldCount,
      input.payloadBytes,
      input.payloadJson,
      userId,
      input.name,
      userId,
      input.name,
    ],
  });
  const row = result.rows[0];

  if (!row) {
    throw new Error("The catalog snapshot version could not be saved.");
  }

  return {
    id: Number(row.id),
    snapshotVersion: Number(row.snapshot_version),
  };
}

export async function removeCatalogSnapshotSeries(userId: string, name: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "DELETE FROM catalog_snapshots WHERE user_id = ? AND name = ? COLLATE NOCASE",
    args: [userId, name],
  });
  return result.rowsAffected;
}

export async function removeCatalogSnapshotVersion(userId: string, id: number) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "DELETE FROM catalog_snapshots WHERE user_id = ? AND id = ?",
    args: [userId, id],
  });
  return result.rowsAffected;
}

export async function addCatalogSnapshotEvent(
  userId: string,
  input: Omit<CatalogSnapshotEvent, "id" | "createdAt" | "payloadJson"> & { payload: unknown },
) {
  await ensureSchema();
  await getClient().execute({
    sql: `
      INSERT INTO catalog_snapshot_events (
        user_id, event_type, snapshot_name, snapshot_id, snapshot_version, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    args: [
      userId,
      input.eventType,
      input.snapshotName,
      input.snapshotId,
      input.snapshotVersion,
      JSON.stringify(input.payload),
    ],
  });
}

export async function getCatalogSnapshotEventsByName(
  userId: string,
  snapshotName: string,
): Promise<CatalogSnapshotEvent[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT id, event_type, snapshot_name, snapshot_id, snapshot_version,
             payload_json, created_at
      FROM catalog_snapshot_events
      WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE
      ORDER BY id DESC
    `,
    args: [userId, snapshotName],
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    eventType: String(row.event_type) as CatalogSnapshotEvent["eventType"],
    snapshotName: String(row.snapshot_name),
    snapshotId: Number(row.snapshot_id),
    snapshotVersion: Number(row.snapshot_version),
    payloadJson: String(row.payload_json),
    createdAt: toIsoDate(row.created_at),
  }));
}
