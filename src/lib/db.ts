import "server-only";

import { createClient, type Client, type InStatement } from "@libsql/client";
import { decryptSecret, encryptSecret } from "@/lib/secret-encryption";
import {
  hasCapturedTranslations,
  SNAPSHOT_RESTORE_GROUPS,
  type CapturedSnapshotConfiguration,
  type SnapshotRestoreGroup,
} from "@/lib/snapshot-configuration";

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

export type CatalogSnapshotRestoreOption = CatalogSnapshotSummary & {
  availableRestoreGroups: SnapshotRestoreGroup[];
};

export type CatalogSnapshotSeriesSummary = CatalogSnapshotSummary & {
  versionCount: number;
  publishedSnapshotId: number | null;
  publishedVersion: number | null;
  isOwner: boolean;
  hasTranslations: boolean;
};

export type CatalogSnapshotEvent = {
  id: number;
  eventType: "snapshot_renamed" | "version_deleted" | "version_published" | "version_unpublished";
  snapshotName: string;
  snapshotId: number;
  snapshotVersion: number;
  payloadJson: string;
  createdAt: string;
};

export type ApplicationEvent = {
  id: number;
  eventType: "environment_added" | "environment_deleted" | "snapshot_deleted";
  resourceType: "environment" | "snapshot";
  resourceId: number | null;
  resourceName: string;
  payloadJson: string;
  createdAt: string;
};

export type FavoriteResourceType = "environment" | "channel" | "snapshot";

export type CollectionViewMode = "cards" | "table";

export type CollectionViewPreference = {
  viewMode: CollectionViewMode;
  showShared: boolean;
  sidebarCollapsed: boolean;
};

export type UserProfile = {
  firstName: string;
  lastName: string;
  timezone: string;
  localSchedulerEnabled: boolean;
  localSchedulerInterval: "minute" | "daily";
  updatedAt: string | null;
};

export type CatalogOperation = {
  id: number; userId: string; kind: "snapshot" | "restore" | "clear" | "refresh" | "database_sync";
  environmentId: number | null; channelId: number | null; snapshotId: number | null;
  operationKey: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  currentStep: string; stepIndex: number; totalSteps: number; payloadJson: string;
  resultJson: string | null; error: string | null; workflowRunId: string | null;
  createdAt: string; updatedAt: string;
};

export type CatalogScheduleAction = "snapshot" | "restore" | "clear" | "refresh";
export type CatalogScheduleFrequency = "daily" | "weekly";

export type CatalogSchedule = {
  id: number;
  userId: string;
  name: string;
  environmentId: number;
  channelId: number;
  action: CatalogScheduleAction;
  frequency: CatalogScheduleFrequency;
  localTime: string;
  weekday: number | null;
  timezone: string;
  enabled: boolean;
  snapshotId: number | null;
  snapshotName: string | null;
  restoreGroups: SnapshotRestoreGroup[];
  nextRunAt: string;
  lastRunAt: string | null;
  lastOperationId: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CatalogSnapshotCaptureState = {
  operationId: number;
  userId: string;
  snapshotName: string;
  environmentId: number;
  channelId: number;
  channelJson: string;
  categoryDataJson: string;
  categoryRecordsJson: string;
  supportingDataJson: string;
  productIdsJson: string;
  nextCategoryIndex: number;
  totalCategories: number;
  initializationComplete: boolean;
  nextProductIndex: number;
  totalProducts: number;
};

export class CatalogOperationAlreadyActiveError extends Error {
  constructor() {
    super("A matching catalog operation is already active.");
    this.name = "CatalogOperationAlreadyActiveError";
  }
}

export function normalizeCatalogSnapshotName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

export function getCatalogSnapshotCaptureKey(name: string) {
  return normalizeCatalogSnapshotName(name).toLocaleLowerCase("en-US");
}

export function getEnvironmentFavoriteKey(environmentId: number) {
  return `environment:${environmentId}`;
}

export function getChannelFavoriteKey(environmentId: number, channelId: number) {
  return `channel:${environmentId}:${channelId}`;
}

export function getSnapshotFavoriteKey(ownerUserId: string, name: string) {
  return `snapshot:${ownerUserId}:${getCatalogSnapshotCaptureKey(name)}`;
}

export function getCatalogSnapshotSeriesKey(ownerUserId: string, name: string) {
  return `${ownerUserId}:${getCatalogSnapshotCaptureKey(name)}`;
}

export function normalizeCatalogSnapshotTag(tag: string) {
  return tag.trim().replace(/\s+/g, " ");
}

let client: Client | undefined;
let schemaReady: Promise<void> | undefined;

export type DevelopmentDatabaseStatus = {
  enabled: boolean;
  activeDatabase: "local" | "remote";
  localUrl: string | null;
  remoteConfigured: boolean;
};

function getDevelopmentLocalDatabaseUrl() {
  if (process.env.NODE_ENV !== "development") return null;
  const url = process.env.LOCAL_DATABASE_URL?.trim();
  return url || null;
}

export function getDevelopmentDatabaseStatus(): DevelopmentDatabaseStatus {
  const localUrl = getDevelopmentLocalDatabaseUrl();
  return {
    enabled: Boolean(localUrl && process.env.TURSO_DATABASE_URL?.trim()),
    activeDatabase: localUrl ? "local" : "remote",
    localUrl,
    remoteConfigured: Boolean(process.env.TURSO_DATABASE_URL?.trim()),
  };
}

function getClient() {
  if (client) {
    return client;
  }

  const localUrl = getDevelopmentLocalDatabaseUrl();
  const url = localUrl ?? process.env.TURSO_DATABASE_URL;
  const authToken = localUrl ? undefined : process.env.TURSO_AUTH_TOKEN;

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

function isTransientDatabaseReadError(error: unknown) {
  const message = error instanceof Error
    ? `${error.name}: ${error.message} ${String(error.cause ?? "")}`
    : String(error);

  return /(?:\b50[234]\b|server_error|network error|fetch failed|econnreset|etimedout|socket hang up)/i.test(
    message,
  );
}

async function executeDatabaseReadWithRetry(
  statement: InStatement,
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await getClient().execute(statement);
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseReadError(error) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
    }
  }

  throw lastError;
}

function payloadHasCapturedTranslations(payloadJson: string) {
  try {
    const payload = JSON.parse(payloadJson) as {
      configuration?: CapturedSnapshotConfiguration;
    };
    return hasCapturedTranslations(payload.configuration) ? 1 : 0;
  } catch {
    return 0;
  }
}

export async function applyCurrentDatabaseSchema(db: Client) {

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
        has_translations INTEGER NOT NULL DEFAULT 0 CHECK(has_translations IN (0, 1)),
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

    const hasTranslations = snapshotColumns.rows.some(
      (column) => column.name === "has_translations",
    );

    if (!hasTranslations) {
      await db.execute(
        "ALTER TABLE catalog_snapshots ADD COLUMN has_translations INTEGER",
      );
      await db.execute(`
        UPDATE catalog_snapshots
        SET has_translations = CASE WHEN json_valid(payload_json) AND (
          EXISTS (
            SELECT 1
            FROM json_each(
              payload_json,
              '$.configuration.localization.resources.productTranslations.data'
            ) AS product_translation_locale
            WHERE json_type(product_translation_locale.value, '$.data.edges') = 'array'
              AND json_array_length(product_translation_locale.value, '$.data.edges') > 0
          )
          OR EXISTS (
            SELECT 1
            FROM json_each(
              payload_json,
              '$.configuration.localization.resources.categoryTranslations.data'
            ) AS category_translation_locale
            WHERE json_type(category_translation_locale.value, '$.data.edges') = 'array'
              AND json_array_length(category_translation_locale.value, '$.data.edges') > 0
          )
        ) THEN 1 ELSE 0 END
        WHERE has_translations IS NULL
      `);
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

    await db.execute(`
      CREATE TABLE IF NOT EXISTS catalog_snapshot_tags (
        user_id TEXT NOT NULL,
        snapshot_name TEXT NOT NULL COLLATE NOCASE,
        tag TEXT NOT NULL COLLATE NOCASE CHECK(length(tag) BETWEEN 1 AND 32),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, snapshot_name, tag)
      )
    `);
    await db.execute(
      "CREATE INDEX IF NOT EXISTS catalog_snapshot_tags_user_tag_idx ON catalog_snapshot_tags(user_id, tag COLLATE NOCASE)",
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS application_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id INTEGER,
        resource_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(
      "CREATE INDEX IF NOT EXISTS application_events_user_created_idx ON application_events(user_id, id DESC)",
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS favorites (
        user_id TEXT NOT NULL,
        resource_type TEXT NOT NULL CHECK(resource_type IN ('environment', 'channel', 'snapshot')),
        resource_key TEXT NOT NULL CHECK(length(resource_key) BETWEEN 1 AND 240),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, resource_type, resource_key)
      )
    `);
    await db.execute(
      "CREATE INDEX IF NOT EXISTS favorites_user_type_idx ON favorites(user_id, resource_type, created_at DESC)",
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS collection_view_preferences (
        user_id TEXT NOT NULL,
        collection_id TEXT NOT NULL CHECK(length(collection_id) BETWEEN 1 AND 120),
        view_mode TEXT NOT NULL DEFAULT 'cards' CHECK(view_mode IN ('cards', 'table')),
        show_shared INTEGER NOT NULL DEFAULT 1 CHECK(show_shared IN (0, 1)),
        sidebar_collapsed INTEGER NOT NULL DEFAULT 0 CHECK(sidebar_collapsed IN (0, 1)),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, collection_id)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        local_scheduler_enabled INTEGER NOT NULL DEFAULT 1 CHECK(local_scheduler_enabled IN (0, 1)),
        local_scheduler_interval TEXT NOT NULL DEFAULT 'minute' CHECK(local_scheduler_interval IN ('minute', 'daily')),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const userProfileColumns = await db.execute(
      "PRAGMA table_info(user_profiles)",
    );
    if (
      !userProfileColumns.rows.some(
        (column) => String(column.name) === "local_scheduler_enabled",
      )
    ) {
      await db.execute(
        "ALTER TABLE user_profiles ADD COLUMN local_scheduler_enabled INTEGER NOT NULL DEFAULT 1 CHECK(local_scheduler_enabled IN (0, 1))",
      );
    }
    if (
      !userProfileColumns.rows.some(
        (column) => String(column.name) === "local_scheduler_interval",
      )
    ) {
      await db.execute(
        "ALTER TABLE user_profiles ADD COLUMN local_scheduler_interval TEXT NOT NULL DEFAULT 'minute' CHECK(local_scheduler_interval IN ('minute', 'daily'))",
      );
    }
    const collectionPreferenceColumns = await db.execute(
      "PRAGMA table_info(collection_view_preferences)",
    );
    if (
      !collectionPreferenceColumns.rows.some(
        (column) => String(column.name) === "sidebar_collapsed",
      )
    ) {
      await db.execute(
        "ALTER TABLE collection_view_preferences ADD COLUMN sidebar_collapsed INTEGER NOT NULL DEFAULT 0 CHECK(sidebar_collapsed IN (0, 1))",
      );
    }

    await db.execute(`CREATE TABLE IF NOT EXISTS catalog_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL,
      environment_id INTEGER, channel_id INTEGER, snapshot_id INTEGER,
      operation_key TEXT,
      status TEXT NOT NULL DEFAULT 'queued', current_step TEXT NOT NULL DEFAULT '',
      step_index INTEGER NOT NULL DEFAULT 0, total_steps INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL, result_json TEXT, error TEXT,
      workflow_run_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const catalogOperationColumns = await db.execute(
      "PRAGMA table_info(catalog_operations)",
    );
    const hasCatalogOperationKey = catalogOperationColumns.rows.some(
      (column) => column.name === "operation_key",
    );
    if (!hasCatalogOperationKey) {
      await db.execute(
        "ALTER TABLE catalog_operations ADD COLUMN operation_key TEXT",
      );
    }
    const hasWorkflowRunId = catalogOperationColumns.rows.some(
      (column) => column.name === "workflow_run_id",
    );
    if (!hasWorkflowRunId) {
      await db.execute(
        "ALTER TABLE catalog_operations ADD COLUMN workflow_run_id TEXT",
      );
    }
    await db.execute("CREATE INDEX IF NOT EXISTS catalog_operations_user_idx ON catalog_operations(user_id, id DESC)");
    await db.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS catalog_operations_one_active_key_idx ON catalog_operations(user_id, kind, operation_key) WHERE operation_key IS NOT NULL AND status IN ('queued', 'running')",
    );
    await db.execute(`CREATE TABLE IF NOT EXISTS catalog_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE CHECK(length(name) BETWEEN 1 AND 100),
      environment_id INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('snapshot', 'restore', 'clear', 'refresh')),
      frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly')),
      local_time TEXT NOT NULL,
      weekday INTEGER CHECK(weekday BETWEEN 0 AND 6),
      timezone TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      snapshot_id INTEGER,
      snapshot_name TEXT COLLATE NOCASE,
      restore_groups_json TEXT NOT NULL DEFAULT '["catalog"]',
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      last_operation_id INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    // Schedule names are labels, not identifiers. Multiple schedules may share a
    // name when their target, timing, or action differs.
    await db.execute("DROP INDEX IF EXISTS catalog_schedules_user_name_idx");
    await db.execute(
      "CREATE INDEX IF NOT EXISTS catalog_schedules_user_name_idx ON catalog_schedules(user_id, name)",
    );
    await db.execute(
      "CREATE INDEX IF NOT EXISTS catalog_schedules_due_idx ON catalog_schedules(enabled, next_run_at)",
    );
    await db.execute(`CREATE TABLE IF NOT EXISTS catalog_snapshot_capture_state (
      operation_id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      snapshot_name TEXT NOT NULL,
      environment_id INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      channel_json TEXT NOT NULL,
      category_data_json TEXT NOT NULL,
      category_records_json TEXT NOT NULL DEFAULT '[]',
      supporting_data_json TEXT NOT NULL,
      product_ids_json TEXT NOT NULL,
      next_category_index INTEGER NOT NULL DEFAULT 0,
      total_categories INTEGER NOT NULL DEFAULT 0,
      initialization_complete INTEGER NOT NULL DEFAULT 0,
      next_product_index INTEGER NOT NULL DEFAULT 0,
      total_products INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const captureStateColumns = await db.execute(
      "PRAGMA table_info(catalog_snapshot_capture_state)",
    );
    const captureStateColumnNames = new Set(
      captureStateColumns.rows.map((column) => String(column.name)),
    );
    if (!captureStateColumnNames.has("category_records_json")) {
      await db.execute(
        "ALTER TABLE catalog_snapshot_capture_state ADD COLUMN category_records_json TEXT NOT NULL DEFAULT '[]'",
      );
    }
    if (!captureStateColumnNames.has("next_category_index")) {
      await db.execute(
        "ALTER TABLE catalog_snapshot_capture_state ADD COLUMN next_category_index INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!captureStateColumnNames.has("total_categories")) {
      await db.execute(
        "ALTER TABLE catalog_snapshot_capture_state ADD COLUMN total_categories INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!captureStateColumnNames.has("initialization_complete")) {
      await db.execute(
        "ALTER TABLE catalog_snapshot_capture_state ADD COLUMN initialization_complete INTEGER NOT NULL DEFAULT 0",
      );
      await db.execute(
        "UPDATE catalog_snapshot_capture_state SET initialization_complete = 1",
      );
    }
    await db.execute(`CREATE TABLE IF NOT EXISTS catalog_snapshot_capture_products (
      operation_id INTEGER NOT NULL,
      product_index INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (operation_id, product_index)
    )`);
}

async function ensureSchema() {
  schemaReady ??= applyCurrentDatabaseSchema(getClient()).catch((error) => {
    schemaReady = undefined;
    throw error;
  });

  return schemaReady;
}

export async function getActiveDatabaseClientForDevelopmentSync() {
  await ensureSchema();
  return getClient();
}

export async function getActiveDatabaseClientForMaintenance() {
  await ensureSchema();
  return getClient();
}

function toCatalogOperation(row: Record<string, unknown>): CatalogOperation {
  return { id: Number(row.id), userId: String(row.user_id), kind: row.kind as CatalogOperation["kind"], environmentId: row.environment_id == null ? null : Number(row.environment_id), channelId: row.channel_id == null ? null : Number(row.channel_id), snapshotId: row.snapshot_id == null ? null : Number(row.snapshot_id), operationKey: row.operation_key == null ? null : String(row.operation_key), status: row.status as CatalogOperation["status"], currentStep: String(row.current_step ?? ""), stepIndex: Number(row.step_index ?? 0), totalSteps: Number(row.total_steps ?? 0), payloadJson: String(row.payload_json), resultJson: row.result_json == null ? null : String(row.result_json), error: row.error == null ? null : String(row.error), workflowRunId: row.workflow_run_id == null ? null : String(row.workflow_run_id), createdAt: toIsoDate(row.created_at), updatedAt: toIsoDate(row.updated_at) };
}

function toCatalogSchedule(row: Record<string, unknown>): CatalogSchedule {
  let restoreGroups: SnapshotRestoreGroup[] = ["catalog"];
  try {
    restoreGroups = (JSON.parse(String(row.restore_groups_json ?? "[]")) as unknown[])
      .flatMap((group) => typeof group === "string" ? [group] : [])
      .filter((group): group is SnapshotRestoreGroup =>
        SNAPSHOT_RESTORE_GROUPS.some((candidate) => candidate.id === group),
      );
  } catch {
    restoreGroups = ["catalog"];
  }
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    environmentId: Number(row.environment_id),
    channelId: Number(row.channel_id),
    action: row.action as CatalogScheduleAction,
    frequency: row.frequency as CatalogScheduleFrequency,
    localTime: String(row.local_time),
    weekday: row.weekday == null ? null : Number(row.weekday),
    timezone: String(row.timezone),
    enabled: Number(row.enabled) === 1,
    snapshotId: row.snapshot_id == null ? null : Number(row.snapshot_id),
    snapshotName: row.snapshot_name == null ? null : String(row.snapshot_name),
    restoreGroups,
    nextRunAt: toIsoDate(row.next_run_at),
    lastRunAt: row.last_run_at == null ? null : toIsoDate(row.last_run_at),
    lastOperationId: row.last_operation_id == null ? null : Number(row.last_operation_id),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: toIsoDate(row.created_at),
    updatedAt: toIsoDate(row.updated_at),
  };
}

export async function getCatalogSchedules(userId: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "SELECT * FROM catalog_schedules WHERE user_id = ? ORDER BY name COLLATE NOCASE",
    args: [userId],
  });
  return result.rows.map((row) => toCatalogSchedule(row as Record<string, unknown>));
}

export async function getCatalogSchedule(userId: string, id: number) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "SELECT * FROM catalog_schedules WHERE user_id = ? AND id = ?",
    args: [userId, id],
  });
  return result.rows[0]
    ? toCatalogSchedule(result.rows[0] as Record<string, unknown>)
    : null;
}

export async function saveCatalogSchedule(
  userId: string,
  input: Omit<CatalogSchedule, "id" | "userId" | "lastRunAt" | "lastOperationId" | "lastError" | "createdAt" | "updatedAt"> & { id?: number },
) {
  await ensureSchema();
  const args = [
    input.name,
    input.environmentId,
    input.channelId,
    input.action,
    input.frequency,
    input.localTime,
    input.weekday,
    input.timezone,
    input.enabled ? 1 : 0,
    input.snapshotId,
    input.snapshotName,
    JSON.stringify(input.restoreGroups),
    input.nextRunAt,
  ] as Array<string | number | null>;
  if (input.id) {
    const result = await getClient().execute({
      sql: `UPDATE catalog_schedules SET name=?, environment_id=?, channel_id=?, action=?, frequency=?, local_time=?, weekday=?, timezone=?, enabled=?, snapshot_id=?, snapshot_name=?, restore_groups_json=?, next_run_at=?, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=? RETURNING id`,
      args: [...args, userId, input.id],
    });
    if (!result.rows[0]) throw new Error("The schedule was not found.");
    return Number(result.rows[0].id);
  }
  const result = await getClient().execute({
    sql: `INSERT INTO catalog_schedules (user_id,name,environment_id,channel_id,action,frequency,local_time,weekday,timezone,enabled,snapshot_id,snapshot_name,restore_groups_json,next_run_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    args: [userId, ...args],
  });
  return Number(result.rows[0].id);
}

export async function deleteCatalogSchedule(userId: string, id: number) {
  await ensureSchema();
  await getClient().execute({
    sql: "DELETE FROM catalog_schedules WHERE user_id = ? AND id = ?",
    args: [userId, id],
  });
}

export async function setCatalogScheduleEnabled(
  userId: string,
  id: number,
  enabled: boolean,
  nextRunAt: string,
) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "UPDATE catalog_schedules SET enabled=?, next_run_at=?, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=? RETURNING id",
    args: [enabled ? 1 : 0, nextRunAt, userId, id],
  });
  if (!result.rows[0]) throw new Error("The schedule was not found.");
}

export async function getDueCatalogSchedules(now: string, userId?: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: userId
      ? "SELECT * FROM catalog_schedules WHERE user_id=? AND enabled=1 AND next_run_at <= ? ORDER BY next_run_at LIMIT 50"
      : "SELECT * FROM catalog_schedules WHERE enabled=1 AND next_run_at <= ? ORDER BY next_run_at LIMIT 50",
    args: userId ? [userId, now] : [now],
  });
  return result.rows.map((row) => toCatalogSchedule(row as Record<string, unknown>));
}

export async function claimCatalogSchedule(
  schedule: CatalogSchedule,
  nextRunAt: string,
) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "UPDATE catalog_schedules SET last_run_at=CURRENT_TIMESTAMP, next_run_at=?, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND enabled=1 AND next_run_at=?",
    args: [nextRunAt, schedule.id, schedule.userId, schedule.nextRunAt],
  });
  return result.rowsAffected > 0;
}

export async function recordCatalogScheduleDispatch(
  userId: string,
  id: number,
  operationId: number | null,
  error: string | null,
) {
  await ensureSchema();
  await getClient().execute({
    sql: "UPDATE catalog_schedules SET last_run_at=COALESCE(last_run_at,CURRENT_TIMESTAMP), last_operation_id=?, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?",
    args: [operationId, error, userId, id],
  });
}

export async function createCatalogOperation(userId: string, input: { kind: CatalogOperation["kind"]; environmentId?: number; channelId?: number; snapshotId?: number; payload: unknown; totalSteps?: number; operationKey?: string }) {
  await ensureSchema();
  const environmentId = input.environmentId ?? null;
  const channelId = input.channelId ?? null;
  const r = await getClient().execute({
    sql: `
      INSERT INTO catalog_operations (
        user_id, kind, environment_id, channel_id, snapshot_id,
        payload_json, total_steps, operation_key
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM catalog_operations
        WHERE user_id = ?
          AND kind = ?
          AND environment_id = ?
          AND channel_id = ?
          AND status IN ('queued', 'running')
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
    args: [
      userId,
      input.kind,
      environmentId,
      channelId,
      input.snapshotId ?? null,
      JSON.stringify(input.payload),
      input.totalSteps ?? 0,
      input.operationKey ?? null,
      userId,
      input.kind,
      environmentId,
      channelId,
    ],
  });
  if (!r.rows[0]) {
    if (input.operationKey || (environmentId !== null && channelId !== null)) {
      throw new CatalogOperationAlreadyActiveError();
    }
    throw new Error("The catalog operation could not be created.");
  }
  return Number(r.rows[0].id);
}
export async function getCatalogOperation(userId: string, id: number) { await ensureSchema(); const r = await getClient().execute({sql:"SELECT * FROM catalog_operations WHERE user_id = ? AND id = ?",args:[userId,id]}); return r.rows[0] ? toCatalogOperation(r.rows[0] as Record<string,unknown>) : null; }
export async function updateCatalogOperation(userId: string, id: number, patch: Partial<Pick<CatalogOperation,"status"|"currentStep"|"stepIndex"|"totalSteps"|"resultJson"|"error"|"payloadJson"|"snapshotId"|"workflowRunId">>) { await ensureSchema(); const fields: string[]=[]; const args: Array<string | number | null>=[]; for (const [k,v] of Object.entries(patch)) { const col=k.replace(/[A-Z]/g,m=>`_${m.toLowerCase()}`); fields.push(`${col} = ?`); args.push(v ?? null); } if (!fields.length) return; fields.push("updated_at = CURRENT_TIMESTAMP"); args.push(userId,id); await getClient().execute({sql:`UPDATE catalog_operations SET ${fields.join(", ")} WHERE user_id = ? AND id = ?`,args}); }

export async function claimCatalogOperationWorkflowRecovery(
  userId: string,
  id: number,
  workflowRunId: string,
  updatedBefore: Date,
  recoverableError: string,
) {
  await ensureSchema();
  try {
    const result = await getClient().execute({
      sql: `
        UPDATE catalog_operations
        SET status = 'running',
            current_step = 'Resuming after local server restart',
            error = NULL,
            workflow_run_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND id = ?
          AND workflow_run_id = ?
          AND (
            status IN ('queued', 'running')
            OR (status = 'failed' AND error = ?)
          )
          AND updated_at < datetime(?)
          AND NOT EXISTS (
            SELECT 1
            FROM catalog_operations AS newer
            WHERE newer.user_id = catalog_operations.user_id
              AND newer.kind = catalog_operations.kind
              AND newer.operation_key = catalog_operations.operation_key
              AND newer.id > catalog_operations.id
          )
      `,
      args: [
        userId,
        id,
        workflowRunId,
        recoverableError,
        updatedBefore.toISOString(),
      ],
    });
    return result.rowsAffected > 0;
  } catch (error) {
    // A concurrent request may create or recover the same operation key after
    // the NOT EXISTS check but before this update acquires SQLite's write lock.
    // Treat that unique-index race as an unsuccessful claim so one historical
    // operation cannot break the shared operations status feed.
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed: catalog_operations.user_id")
    ) {
      return false;
    }
    throw error;
  }
}

export async function getRecentCatalogOperations(userId: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT *
      FROM catalog_operations
      WHERE user_id = ?
        AND (
          status IN ('queued', 'running')
          OR updated_at >= datetime('now', '-1 day')
        )
      ORDER BY
        CASE WHEN status IN ('queued', 'running') THEN 0 ELSE 1 END,
        updated_at DESC,
        id DESC
      LIMIT 50
    `,
    args: [userId],
  });
  return result.rows.map((row) => toCatalogOperation(row as Record<string, unknown>));
}

export async function getCatalogOperations(userId: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT *
      FROM catalog_operations
      WHERE user_id = ?
      ORDER BY updated_at DESC, id DESC
    `,
    args: [userId],
  });
  return result.rows.map((row) => toCatalogOperation(row as Record<string, unknown>));
}

export async function getWorkflowCatalogOperations(userId: string, limit = 100) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT *
      FROM catalog_operations
      WHERE user_id = ? AND workflow_run_id IS NOT NULL
      ORDER BY
        CASE WHEN status IN ('queued', 'running') THEN 0 ELSE 1 END,
        updated_at DESC,
        id DESC
      LIMIT ?
    `,
    args: [userId, Math.min(Math.max(limit, 1), 250)],
  });
  return result.rows.map((row) => toCatalogOperation(row as Record<string, unknown>));
}

export async function getCatalogSnapshotCaptureStates(
  userId: string,
  operationIds: number[],
) {
  await ensureSchema();
  if (operationIds.length === 0) return [];
  const placeholders = operationIds.map(() => "?").join(",");
  const result = await getClient().execute({
    sql: `
      SELECT *
      FROM catalog_snapshot_capture_state
      WHERE user_id = ? AND operation_id IN (${placeholders})
    `,
    args: [userId, ...operationIds],
  });
  return result.rows.map((row) =>
    toCatalogSnapshotCaptureState(row as Record<string, unknown>)
  );
}

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
  if (process.env.NODE_ENV !== "development") {
    await expireStaleSnapshotOperations(userId);
  }
  const result = await getClient().execute({
    sql: "SELECT * FROM catalog_operations WHERE user_id = ? AND kind = 'snapshot' AND status IN ('queued', 'running') ORDER BY id DESC",
    args: [userId],
  });
  return result.rows.map((row) => toCatalogOperation(row as Record<string, unknown>));
}

export async function expireStaleSnapshotOperations(userId: string) {
  await ensureSchema();
  await getClient().execute({
    sql: `
      UPDATE catalog_operations
      SET status = 'failed',
          current_step = 'Failed',
          error = 'The previous snapshot worker stopped before completing. Start the capture again; durable captures now resume in server-side batches.',
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND kind = 'snapshot'
        AND status = 'running'
        AND updated_at < datetime('now', '-10 minutes')
    `,
    args: [userId],
  });
}

function toCatalogSnapshotCaptureState(
  row: Record<string, unknown>,
): CatalogSnapshotCaptureState {
  return {
    operationId: Number(row.operation_id),
    userId: String(row.user_id),
    snapshotName: String(row.snapshot_name),
    environmentId: Number(row.environment_id),
    channelId: Number(row.channel_id),
    channelJson: String(row.channel_json),
    categoryDataJson: String(row.category_data_json),
    categoryRecordsJson: String(row.category_records_json ?? "[]"),
    supportingDataJson: String(row.supporting_data_json),
    productIdsJson: String(row.product_ids_json),
    nextCategoryIndex: Number(row.next_category_index ?? 0),
    totalCategories: Number(row.total_categories ?? 0),
    initializationComplete: Number(row.initialization_complete ?? 0) === 1,
    nextProductIndex: Number(row.next_product_index),
    totalProducts: Number(row.total_products),
  };
}

export async function initializeCatalogSnapshotCategoryState(input: {
  operationId: number;
  userId: string;
  snapshotName: string;
  environmentId: number;
  channelId: number;
  channelJson: string;
  categoryDataJson: string;
  categoryRecordsJson: string;
  totalCategories: number;
}) {
  await ensureSchema();
  await getClient().execute({
    sql: `
      INSERT INTO catalog_snapshot_capture_state (
        operation_id, user_id, snapshot_name, environment_id, channel_id,
        channel_json, category_data_json, category_records_json,
        supporting_data_json, product_ids_json, total_categories, total_products
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, '{}', '[]', ?, 0
      WHERE EXISTS (
        SELECT 1 FROM catalog_operations
        WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')
      )
      ON CONFLICT(operation_id) DO NOTHING
    `,
    args: [
      input.operationId,
      input.userId,
      input.snapshotName,
      input.environmentId,
      input.channelId,
      input.channelJson,
      input.categoryDataJson,
      input.categoryRecordsJson,
      input.totalCategories,
      input.operationId,
      input.userId,
    ],
  });
  const state = await getCatalogSnapshotCaptureState(input.userId, input.operationId);
  if (!state) throw new Error("Snapshot capture was cancelled before category initialization.");
  return state;
}

export async function saveCatalogSnapshotCategoryBatch(input: {
  userId: string;
  operationId: number;
  startCategoryIndex: number;
  nextCategoryIndex: number;
  categoryDataJson: string;
}) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      UPDATE catalog_snapshot_capture_state
      SET category_data_json = ?,
          next_category_index = MAX(next_category_index, ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE operation_id = ? AND user_id = ?
        AND next_category_index = ?
        AND EXISTS (
          SELECT 1 FROM catalog_operations
          WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')
        )
    `,
    args: [
      input.categoryDataJson,
      input.nextCategoryIndex,
      input.operationId,
      input.userId,
      input.startCategoryIndex,
      input.operationId,
      input.userId,
    ],
  });
  if (result.rowsAffected === 0) throw new Error("Snapshot capture was cancelled.");
}

export async function completeCatalogSnapshotCaptureInitialization(input: {
  userId: string;
  operationId: number;
  supportingDataJson: string;
  productIdsJson: string;
  totalProducts: number;
}) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      UPDATE catalog_snapshot_capture_state
      SET supporting_data_json = ?,
          product_ids_json = ?,
          total_products = ?,
          initialization_complete = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE operation_id = ? AND user_id = ?
        AND next_category_index >= total_categories
        AND EXISTS (
          SELECT 1 FROM catalog_operations
          WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')
        )
    `,
    args: [
      input.supportingDataJson,
      input.productIdsJson,
      input.totalProducts,
      input.operationId,
      input.userId,
      input.operationId,
      input.userId,
    ],
  });
  if (result.rowsAffected === 0) {
    throw new Error("Snapshot category capture is incomplete or was cancelled.");
  }
  const state = await getCatalogSnapshotCaptureState(input.userId, input.operationId);
  if (!state) throw new Error("Snapshot capture state was not found.");
  return state;
}

export async function getCatalogSnapshotCaptureState(
  userId: string,
  operationId: number,
) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT *
      FROM catalog_snapshot_capture_state
      WHERE user_id = ? AND operation_id = ?
      LIMIT 1
    `,
    args: [userId, operationId],
  });
  const row = result.rows[0];
  return row
    ? toCatalogSnapshotCaptureState(row as Record<string, unknown>)
    : null;
}

export async function saveCatalogSnapshotProductBatch(input: {
  userId: string;
  operationId: number;
  startIndex: number;
  nextProductIndex: number;
  productsJson: string[];
}) {
  await ensureSchema();
  const operation = await getCatalogOperation(input.userId, input.operationId);
  if (!operation || !["queued", "running"].includes(operation.status)) {
    throw new Error("Snapshot capture was cancelled.");
  }
  const statements = input.productsJson.map((payloadJson, offset) => ({
    sql: `
      INSERT INTO catalog_snapshot_capture_products (
        operation_id, product_index, payload_json
      ) VALUES (?, ?, ?)
      ON CONFLICT(operation_id, product_index)
      DO UPDATE SET payload_json = excluded.payload_json
    `,
    args: [input.operationId, input.startIndex + offset, payloadJson],
  }));
  statements.push({
    sql: `
      UPDATE catalog_snapshot_capture_state
      SET next_product_index = MAX(next_product_index, ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE operation_id = ? AND user_id = ?
    `,
    args: [input.nextProductIndex, input.operationId, input.userId],
  });
  await getClient().batch(statements, "write");
}

export async function getCatalogSnapshotCaptureProducts(
  operationId: number,
) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT payload_json
      FROM catalog_snapshot_capture_products
      WHERE operation_id = ?
      ORDER BY product_index ASC
    `,
    args: [operationId],
  });
  return result.rows.map((row) => String(row.payload_json));
}

export async function removeCatalogSnapshotCaptureState(operationId: number) {
  await ensureSchema();
  await getClient().batch(
    [
      {
        sql: "DELETE FROM catalog_snapshot_capture_products WHERE operation_id = ?",
        args: [operationId],
      },
      {
        sql: "DELETE FROM catalog_snapshot_capture_state WHERE operation_id = ?",
        args: [operationId],
      },
    ],
    "write",
  );
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

export async function getFavoriteResourceKeys(
  userId: string,
  resourceType: FavoriteResourceType,
) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT resource_key
      FROM favorites
      WHERE user_id = ? AND resource_type = ?
    `,
    args: [userId, resourceType],
  });
  return new Set(result.rows.map((row) => String(row.resource_key)));
}

export async function getCollectionViewPreference(
  userId: string,
  collectionId: string,
): Promise<CollectionViewPreference> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT view_mode, show_shared, sidebar_collapsed
      FROM collection_view_preferences
      WHERE user_id = ? AND collection_id = ?
      LIMIT 1
    `,
    args: [userId, collectionId],
  });
  const row = result.rows[0];
  return {
    viewMode: row?.view_mode === "table" ? "table" : "cards",
    showShared: row?.show_shared == null ? true : Number(row.show_shared) === 1,
    sidebarCollapsed: Number(row?.sidebar_collapsed) === 1,
  };
}

export async function getUserProfile(
  userId: string,
  defaults: Partial<Omit<UserProfile, "updatedAt">> = {},
): Promise<UserProfile> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT first_name, last_name, timezone, local_scheduler_enabled, local_scheduler_interval, updated_at
      FROM user_profiles
      WHERE user_id = ?
      LIMIT 1
    `,
    args: [userId],
  });
  const row = result.rows[0];
  return {
    firstName: row ? String(row.first_name) : defaults.firstName ?? "",
    lastName: row ? String(row.last_name) : defaults.lastName ?? "",
    timezone: row ? String(row.timezone) : defaults.timezone ?? "UTC",
    localSchedulerEnabled: row
      ? Number(row.local_scheduler_enabled) === 1
      : defaults.localSchedulerEnabled ?? true,
    localSchedulerInterval: row?.local_scheduler_interval === "daily"
      ? "daily"
      : defaults.localSchedulerInterval ?? "minute",
    updatedAt: row ? toIsoDate(row.updated_at) : null,
  };
}

export async function saveUserProfile(
  userId: string,
  profile: Pick<UserProfile, "firstName" | "lastName" | "timezone">,
) {
  await ensureSchema();
  await getClient().execute({
    sql: `
      INSERT INTO user_profiles (user_id, first_name, last_name, timezone)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        timezone = excluded.timezone,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [userId, profile.firstName, profile.lastName, profile.timezone],
  });
}

export async function setLocalSchedulerEnabled(
  userId: string,
  enabled: boolean,
) {
  await ensureSchema();
  await getClient().execute({
    sql: `
      INSERT INTO user_profiles (user_id, local_scheduler_enabled)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        local_scheduler_enabled = excluded.local_scheduler_enabled,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [userId, enabled ? 1 : 0],
  });
}

export async function setLocalSchedulerInterval(
  userId: string,
  interval: "minute" | "daily",
) {
  await ensureSchema();
  await getClient().execute({
    sql: `
      INSERT INTO user_profiles (user_id, local_scheduler_interval)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        local_scheduler_interval = excluded.local_scheduler_interval,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [userId, interval],
  });
}

export async function getCollectionViewPreferences(userId: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT collection_id, view_mode, show_shared, sidebar_collapsed
      FROM collection_view_preferences
      WHERE user_id = ?
    `,
    args: [userId],
  });
  const preferences = Object.fromEntries(
    result.rows.map((row) => [
      String(row.collection_id),
      {
        viewMode: row.view_mode === "table" ? "table" : "cards",
        showShared: Number(row.show_shared) === 1,
        sidebarCollapsed: Number(row.sidebar_collapsed) === 1,
      } satisfies CollectionViewPreference,
    ]),
  );
  if (!preferences["app-shell"]) {
    preferences["app-shell"] = {
      viewMode: "cards",
      showShared: true,
      sidebarCollapsed: result.rows.some(
        (row) => Number(row.sidebar_collapsed) === 1,
      ),
    };
  }
  return preferences;
}

export async function setCollectionViewMode(
  userId: string,
  collectionId: string,
  viewMode: CollectionViewMode,
) {
  await ensureSchema();
  await getClient().execute({
    sql: `
      INSERT INTO collection_view_preferences (user_id, collection_id, view_mode)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, collection_id) DO UPDATE SET
        view_mode = excluded.view_mode,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [userId, collectionId, viewMode],
  });
}

export async function setCollectionSharedVisibility(
  userId: string,
  collectionId: string,
  showShared: boolean,
) {
  await ensureSchema();
  await getClient().execute({
    sql: `
      INSERT INTO collection_view_preferences (user_id, collection_id, show_shared)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, collection_id) DO UPDATE SET
        show_shared = excluded.show_shared,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [userId, collectionId, showShared ? 1 : 0],
  });
}

export async function setCollectionSidebarCollapsed(
  userId: string,
  collectionId: string,
  sidebarCollapsed: boolean,
) {
  await ensureSchema();
  await getClient().execute({
    sql: `
      INSERT INTO collection_view_preferences (user_id, collection_id, sidebar_collapsed)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, collection_id) DO UPDATE SET
        sidebar_collapsed = excluded.sidebar_collapsed,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [userId, collectionId, sidebarCollapsed ? 1 : 0],
  });
}

export async function toggleFavoriteResource(
  userId: string,
  resourceType: FavoriteResourceType,
  resourceKey: string,
) {
  await ensureSchema();
  if (!resourceKey || resourceKey.length > 240) {
    throw new Error("Invalid favorite resource.");
  }

  const transaction = await getClient().transaction("write");
  try {
    const existing = await transaction.execute({
      sql: `
        SELECT 1
        FROM favorites
        WHERE user_id = ? AND resource_type = ? AND resource_key = ?
        LIMIT 1
      `,
      args: [userId, resourceType, resourceKey],
    });

    if (existing.rows[0]) {
      await transaction.execute({
        sql: "DELETE FROM favorites WHERE user_id = ? AND resource_type = ? AND resource_key = ?",
        args: [userId, resourceType, resourceKey],
      });
      await transaction.commit();
      return false;
    }

    await transaction.execute({
      sql: "INSERT INTO favorites (user_id, resource_type, resource_key) VALUES (?, ?, ?)",
      args: [userId, resourceType, resourceKey],
    });
    await transaction.commit();
    return true;
  } finally {
    transaction.close();
  }
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
  const rawValue = String(value).trim();
  const normalizedValue = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawValue)
    ? rawValue
    : `${rawValue.replace(" ", "T")}Z`;
  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? normalizedValue : date.toISOString();
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

export async function hasBigCommerceEnvironment(userId: string, id: number) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "SELECT 1 FROM bigcommerce_environments WHERE id = ? AND user_id = ? LIMIT 1",
    args: [id, userId],
  });
  return Boolean(result.rows[0]);
}

export async function addBigCommerceEnvironment(
  userId: string,
  input: BigCommerceEnvironmentInput & { accessToken: string },
) {
  await ensureSchema();
  const encryptedToken = encryptSecret(input.accessToken, userId);
  const transaction = await getClient().transaction("write");
  try {
    const result = await transaction.execute({
      sql: `
        INSERT INTO bigcommerce_environments (
          user_id,
          name,
          store_hash,
          access_token_encrypted,
          access_token_hint
        ) VALUES (?, ?, ?, ?, ?)
        RETURNING id
      `,
      args: [
        userId,
        input.name,
        input.storeHash,
        encryptedToken,
        input.accessToken.slice(-4),
      ],
    });
    const environmentId = Number(result.rows[0]?.id);
    await transaction.execute({
      sql: `
        INSERT INTO application_events (
          user_id, event_type, resource_type, resource_id, resource_name, payload_json
        ) VALUES (?, 'environment_added', 'environment', ?, ?, ?)
      `,
      args: [userId, environmentId, input.name, JSON.stringify({ storeHash: input.storeHash })],
    });
    await transaction.commit();
    return environmentId;
  } finally {
    transaction.close();
  }
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
  const transaction = await getClient().transaction("write");
  try {
    const environmentResult = await transaction.execute({
      sql: "SELECT name, store_hash FROM bigcommerce_environments WHERE id = ? AND user_id = ? LIMIT 1",
      args: [id, userId],
    });
    const environment = environmentResult.rows[0];
    if (!environment) {
      await transaction.rollback();
      return 0;
    }
    await transaction.execute({
      sql: `
        INSERT INTO application_events (
          user_id, event_type, resource_type, resource_id, resource_name, payload_json
        ) VALUES (?, 'environment_deleted', 'environment', ?, ?, ?)
      `,
      args: [
        userId,
        id,
        String(environment.name),
        JSON.stringify({ storeHash: String(environment.store_hash) }),
      ],
    });
    await transaction.execute({
      sql: `
        DELETE FROM favorites
        WHERE user_id = ? AND (
          (resource_type = 'environment' AND resource_key = ?) OR
          (resource_type = 'channel' AND resource_key LIKE ?)
        )
      `,
      args: [
        userId,
        getEnvironmentFavoriteKey(id),
        `${getChannelFavoriteKey(id, 0).slice(0, -1)}%`,
      ],
    });
    const result = await transaction.execute({
      sql: "DELETE FROM bigcommerce_environments WHERE id = ? AND user_id = ?",
      args: [id, userId],
    });
    await transaction.commit();
    return result.rowsAffected;
  } finally {
    transaction.close();
  }
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
  has_translations,
  published_at,
  created_at,
  updated_at
`;

export async function getCatalogSnapshots(
  userId: string,
): Promise<CatalogSnapshotRestoreOption[]> {
  await ensureSchema();
  const configurationGroups = SNAPSHOT_RESTORE_GROUPS.filter(
    (group) => group.id !== "catalog",
  );
  const availabilityColumns = configurationGroups.map(
    (group) => `CASE WHEN json_valid(payload_json) AND json_type(payload_json, '$.configuration.${group.id}') = 'object' THEN 1 ELSE 0 END AS has_${group.id}`,
  ).join(",\n        ");
  const result = await getClient().execute({
    sql: `
      SELECT ${catalogSnapshotColumns},
        ${availabilityColumns}
      FROM catalog_snapshots
      WHERE user_id = ? OR published_at IS NOT NULL
      ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, id DESC
    `,
    args: [userId, userId],
  });

  return result.rows.map((row) => ({
    ...toCatalogSnapshotSummary(row),
    availableRestoreGroups: [
      "catalog" as const,
      ...configurationGroups.flatMap((group) =>
        Number(row[`has_${group.id}`]) === 1 ? [group.id] : [],
      ),
    ],
  }));
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
  const ownedResult = await executeDatabaseReadWithRetry({
    sql: `
      SELECT ${catalogSnapshotColumns},
             version_count, published_snapshot_id, published_version
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

  const sharedResult = await executeDatabaseReadWithRetry({
    sql: `
      SELECT ${catalogSnapshotColumns},
             1 AS version_count,
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
    hasTranslations: Number(row.has_translations) === 1,
  })).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export async function getAccessibleCatalogSnapshotTagSeries(userId: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT tags.user_id, tags.snapshot_name, tags.tag
      FROM catalog_snapshot_tags AS tags
      WHERE tags.tag <> 'localized' COLLATE NOCASE
        AND (tags.user_id = ? OR EXISTS (
        SELECT 1
        FROM catalog_snapshots AS snapshots
        WHERE snapshots.user_id = tags.user_id
          AND snapshots.name = tags.snapshot_name COLLATE NOCASE
          AND snapshots.published_at IS NOT NULL
      ))
      ORDER BY tags.tag COLLATE NOCASE ASC
    `,
    args: [userId],
  });
  const tagsBySeries = new Map<string, string[]>();
  for (const row of result.rows) {
    const ownerUserId = String(row.user_id);
    const snapshotName = String(row.snapshot_name);
    const key = getCatalogSnapshotSeriesKey(ownerUserId, snapshotName);
    const tags = tagsBySeries.get(key) ?? [];
    tags.push(String(row.tag));
    tagsBySeries.set(key, tags);
  }
  return tagsBySeries;
}

export async function getCatalogSnapshotTags(ownerUserId: string, name: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT tag
      FROM catalog_snapshot_tags
      WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE
        AND tag <> 'localized' COLLATE NOCASE
      ORDER BY tag COLLATE NOCASE ASC
    `,
    args: [ownerUserId, name],
  });
  return result.rows.map((row) => String(row.tag));
}

export async function getCatalogSnapshotTagSuggestions(userId: string) {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT tag
      FROM catalog_snapshot_tags
      WHERE user_id = ?
        AND tag <> 'localized' COLLATE NOCASE
      GROUP BY tag COLLATE NOCASE
      ORDER BY tag COLLATE NOCASE ASC
    `,
    args: [userId],
  });
  return result.rows.map((row) => String(row.tag));
}

export async function addCatalogSnapshotTag(
  userId: string,
  snapshotId: number,
  requestedTag: string,
) {
  await ensureSchema();
  const tag = normalizeCatalogSnapshotTag(requestedTag);
  if (tag.length < 1 || tag.length > 32) {
    return { error: "Tags must contain between 1 and 32 characters.", tags: [] } as const;
  }
  if (tag.localeCompare("localized", "en-US", { sensitivity: "base" }) === 0) {
    return { error: "Localized is a computed snapshot tag.", tags: [] } as const;
  }

  const transaction = await getClient().transaction("write");
  try {
    const snapshotResult = await transaction.execute({
      sql: "SELECT name FROM catalog_snapshots WHERE user_id = ? AND id = ? LIMIT 1",
      args: [userId, snapshotId],
    });
    const snapshot = snapshotResult.rows[0];
    if (!snapshot) {
      await transaction.rollback();
      return { error: "Snapshot not found.", tags: [] } as const;
    }
    const name = String(snapshot.name);
    const existingResult = await transaction.execute({
      sql: "SELECT 1 FROM catalog_snapshot_tags WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE AND tag = ? COLLATE NOCASE LIMIT 1",
      args: [userId, name, tag],
    });
    if (existingResult.rows.length > 0) {
      const tagsResult = await transaction.execute({
        sql: "SELECT tag FROM catalog_snapshot_tags WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE ORDER BY tag COLLATE NOCASE ASC",
        args: [userId, name],
      });
      await transaction.commit();
      return { error: null, tags: tagsResult.rows.map((row) => String(row.tag)) } as const;
    }
    const countResult = await transaction.execute({
      sql: "SELECT COUNT(*) AS count FROM catalog_snapshot_tags WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE",
      args: [userId, name],
    });
    if (Number(countResult.rows[0]?.count ?? 0) >= 12) {
      await transaction.rollback();
      return { error: "A snapshot can have up to 12 custom tags.", tags: [] } as const;
    }
    await transaction.execute({
      sql: "INSERT INTO catalog_snapshot_tags (user_id, snapshot_name, tag) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      args: [userId, name, tag],
    });
    const tagsResult = await transaction.execute({
      sql: "SELECT tag FROM catalog_snapshot_tags WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE ORDER BY tag COLLATE NOCASE ASC",
      args: [userId, name],
    });
    await transaction.commit();
    return { error: null, tags: tagsResult.rows.map((row) => String(row.tag)) } as const;
  } finally {
    transaction.close();
  }
}

export async function removeCatalogSnapshotTag(
  userId: string,
  snapshotId: number,
  requestedTag: string,
) {
  await ensureSchema();
  const tag = normalizeCatalogSnapshotTag(requestedTag);
  if (!tag) return { error: "Invalid tag.", tags: [] } as const;

  const transaction = await getClient().transaction("write");
  try {
    const snapshotResult = await transaction.execute({
      sql: "SELECT name FROM catalog_snapshots WHERE user_id = ? AND id = ? LIMIT 1",
      args: [userId, snapshotId],
    });
    const snapshot = snapshotResult.rows[0];
    if (!snapshot) {
      await transaction.rollback();
      return { error: "Snapshot not found.", tags: [] } as const;
    }
    const name = String(snapshot.name);
    await transaction.execute({
      sql: "DELETE FROM catalog_snapshot_tags WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE AND tag = ? COLLATE NOCASE",
      args: [userId, name, tag],
    });
    const tagsResult = await transaction.execute({
      sql: "SELECT tag FROM catalog_snapshot_tags WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE ORDER BY tag COLLATE NOCASE ASC",
      args: [userId, name],
    });
    await transaction.commit();
    return { error: null, tags: tagsResult.rows.map((row) => String(row.tag)) } as const;
  } finally {
    transaction.close();
  }
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

export async function getAccessibleCatalogSnapshotSummary(
  userId: string,
  id: number,
): Promise<CatalogSnapshotSummary | null> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT ${catalogSnapshotColumns}
      FROM catalog_snapshots
      WHERE id = ? AND (user_id = ? OR published_at IS NOT NULL)
      LIMIT 1
    `,
    args: [id, userId],
  });
  const row = result.rows[0];
  return row ? toCatalogSnapshotSummary(row) : null;
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

export async function renameCatalogSnapshotSeries(
  userId: string,
  snapshotId: number,
  requestedName: string,
) {
  await ensureSchema();
  const name = normalizeCatalogSnapshotName(requestedName);
  if (name.length < 1 || name.length > 80) {
    return { error: "Snapshot names must contain between 1 and 80 characters." } as const;
  }

  const transaction = await getClient().transaction("write");
  try {
    const snapshotResult = await transaction.execute({
      sql: `SELECT ${catalogSnapshotColumns} FROM catalog_snapshots WHERE user_id = ? AND id = ? LIMIT 1`,
      args: [userId, snapshotId],
    });
    const row = snapshotResult.rows[0];
    if (!row) {
      await transaction.rollback();
      return { error: "Snapshot not found." } as const;
    }

    const snapshot = toCatalogSnapshotSummary(row);
    const previousName = snapshot.name;
    const previousKey = getCatalogSnapshotCaptureKey(previousName);
    const nextKey = getCatalogSnapshotCaptureKey(name);
    const previousFavoriteKey = getSnapshotFavoriteKey(userId, previousName);
    const nextFavoriteKey = getSnapshotFavoriteKey(userId, name);

    const activeResult = await transaction.execute({
      sql: `
        SELECT 1
        FROM catalog_operations
        WHERE user_id = ? AND kind = 'snapshot'
          AND status IN ('queued', 'running') AND operation_key = ?
        LIMIT 1
      `,
      args: [userId, previousKey],
    });
    if (activeResult.rows[0]) {
      await transaction.rollback();
      return { error: "Wait for the active snapshot capture to finish before renaming it." } as const;
    }

    if (previousKey !== nextKey) {
      const conflictResult = await transaction.execute({
        sql: "SELECT 1 FROM catalog_snapshots WHERE user_id = ? AND name = ? COLLATE NOCASE LIMIT 1",
        args: [userId, name],
      });
      if (conflictResult.rows[0]) {
        await transaction.rollback();
        return { error: "A snapshot with this name already exists." } as const;
      }
    }

    if (previousName === name) {
      await transaction.commit();
      return {
        error: null,
        name,
        snapshotIds: [snapshot.id],
        published: Boolean(snapshot.publishedAt),
      } as const;
    }

    const versionsResult = await transaction.execute({
      sql: `SELECT id, published_at FROM catalog_snapshots WHERE user_id = ? AND name = ? COLLATE NOCASE`,
      args: [userId, previousName],
    });
    const snapshotIds = versionsResult.rows.map((version) => Number(version.id));
    const published = versionsResult.rows.some((version) => version.published_at != null);

    await transaction.execute({
      sql: `UPDATE catalog_snapshots SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND name = ? COLLATE NOCASE`,
      args: [name, userId, previousName],
    });
    await transaction.execute({
      sql: `UPDATE catalog_snapshot_events SET snapshot_name = ? WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE`,
      args: [name, userId, previousName],
    });
    await transaction.execute({
      sql: `UPDATE catalog_snapshot_tags SET snapshot_name = ? WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE`,
      args: [name, userId, previousName],
    });
    await transaction.execute({
      sql: `
        UPDATE favorites
        SET resource_key = ?
        WHERE resource_type = 'snapshot' AND resource_key = ?
      `,
      args: [nextFavoriteKey, previousFavoriteKey],
    });
    await transaction.execute({
      sql: `
        INSERT INTO catalog_snapshot_events (
          user_id, event_type, snapshot_name, snapshot_id, snapshot_version, payload_json
        ) VALUES (?, 'snapshot_renamed', ?, ?, ?, ?)
      `,
      args: [userId, name, snapshot.id, snapshot.snapshotVersion, JSON.stringify({ previousName, name })],
    });
    await transaction.commit();
    return { error: null, name, snapshotIds, published } as const;
  } finally {
    transaction.close();
  }
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
        has_translations,
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
      payloadHasCapturedTranslations(input.payloadJson),
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

export async function completeCatalogSnapshotCapture(
  userId: string,
  operationId: number,
  input: CatalogSnapshotInput,
) {
  await ensureSchema();
  const transaction = await getClient().transaction("write");

  try {
    const operationResult = await transaction.execute({
      sql: `
        SELECT status, snapshot_id
        FROM catalog_operations
        WHERE user_id = ? AND id = ?
        LIMIT 1
      `,
      args: [userId, operationId],
    });
    const operation = operationResult.rows[0];
    if (!operation) throw new Error("Snapshot operation was not found.");
    if (operation.snapshot_id != null) {
      await transaction.commit();
      return Number(operation.snapshot_id);
    }
    if (!["queued", "running"].includes(String(operation.status))) {
      throw new Error("Snapshot capture was cancelled before it was saved.");
    }

    const result = await transaction.execute({
      sql: `
        INSERT INTO catalog_snapshots (
          user_id, name, snapshot_version, format_version,
          source_environment_id, source_environment_name, source_store_hash,
          source_channel_id, source_channel_name, category_count,
          product_count, variant_count, image_count, metafield_count,
          payload_bytes, has_translations, payload_json
        )
        SELECT
          ?, ?, COALESCE(MAX(version_number), 0) + 1, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?
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
        payloadHasCapturedTranslations(input.payloadJson),
        input.payloadJson,
        userId,
        input.name,
        userId,
        input.name,
      ],
    });
    const saved = result.rows[0];
    if (!saved) throw new Error("The catalog snapshot version could not be saved.");
    const snapshotId = Number(saved.id);
    const snapshotVersion = Number(saved.snapshot_version);

    await transaction.execute({
      sql: `
        UPDATE catalog_operations
        SET status = 'completed', current_step = ?, step_index = 100,
            total_steps = 100, snapshot_id = ?, result_json = ?, error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND id = ? AND status IN ('queued', 'running')
      `,
      args: [
        `Snapshot saved as version ${snapshotVersion}`,
        snapshotId,
        JSON.stringify(snapshotId),
        userId,
        operationId,
      ],
    });
    await transaction.execute({
      sql: "DELETE FROM catalog_snapshot_capture_products WHERE operation_id = ?",
      args: [operationId],
    });
    await transaction.execute({
      sql: "DELETE FROM catalog_snapshot_capture_state WHERE operation_id = ?",
      args: [operationId],
    });
    await transaction.commit();
    return snapshotId;
  } finally {
    transaction.close();
  }
}

export async function removeCatalogSnapshotSeries(userId: string, name: string) {
  await ensureSchema();
  const transaction = await getClient().transaction("write");
  try {
    const versionsResult = await transaction.execute({
      sql: `
        SELECT id, snapshot_version, source_environment_name, source_channel_name,
               category_count, product_count, variant_count
        FROM catalog_snapshots
        WHERE user_id = ? AND name = ? COLLATE NOCASE
        ORDER BY snapshot_version DESC, id DESC
      `,
      args: [userId, name],
    });
    if (versionsResult.rows.length === 0) {
      await transaction.rollback();
      return 0;
    }
    const latest = versionsResult.rows[0];
    await transaction.execute({
      sql: `
        INSERT INTO application_events (
          user_id, event_type, resource_type, resource_id, resource_name, payload_json
        ) VALUES (?, 'snapshot_deleted', 'snapshot', ?, ?, ?)
      `,
      args: [
        userId,
        Number(latest.id),
        name,
        JSON.stringify({
          versionCount: versionsResult.rows.length,
          latestVersion: Number(latest.snapshot_version),
          sourceEnvironmentName: String(latest.source_environment_name),
          sourceChannelName: String(latest.source_channel_name),
          categoryCount: Number(latest.category_count),
          productCount: Number(latest.product_count),
          variantCount: Number(latest.variant_count),
        }),
      ],
    });
    await transaction.execute({
      sql: "DELETE FROM favorites WHERE resource_type = 'snapshot' AND resource_key = ?",
      args: [getSnapshotFavoriteKey(userId, name)],
    });
    await transaction.execute({
      sql: "DELETE FROM catalog_snapshot_tags WHERE user_id = ? AND snapshot_name = ? COLLATE NOCASE",
      args: [userId, name],
    });
    const result = await transaction.execute({
      sql: "DELETE FROM catalog_snapshots WHERE user_id = ? AND name = ? COLLATE NOCASE",
      args: [userId, name],
    });
    await transaction.commit();
    return result.rowsAffected;
  } finally {
    transaction.close();
  }
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

export async function getCatalogSnapshotEvents(
  userId: string,
): Promise<CatalogSnapshotEvent[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT id, event_type, snapshot_name, snapshot_id, snapshot_version,
             payload_json, created_at
      FROM catalog_snapshot_events
      WHERE user_id = ?
      ORDER BY id DESC
    `,
    args: [userId],
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

export async function getApplicationEvents(userId: string): Promise<ApplicationEvent[]> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: `
      SELECT id, event_type, resource_type, resource_id, resource_name,
             payload_json, created_at
      FROM application_events
      WHERE user_id = ?
      ORDER BY id DESC
    `,
    args: [userId],
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    eventType: String(row.event_type) as ApplicationEvent["eventType"],
    resourceType: String(row.resource_type) as ApplicationEvent["resourceType"],
    resourceId: row.resource_id == null ? null : Number(row.resource_id),
    resourceName: String(row.resource_name),
    payloadJson: String(row.payload_json),
    createdAt: toIsoDate(row.created_at),
  }));
}
