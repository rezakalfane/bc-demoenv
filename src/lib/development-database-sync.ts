import "server-only";

import { Buffer } from "node:buffer";
import {
  createClient,
  type Client,
  type InStatement,
  type InValue,
} from "@libsql/client";
import {
  getActiveDatabaseClientForMaintenance,
  getActiveDatabaseClientForDevelopmentSync,
  getDevelopmentDatabaseStatus,
} from "@/lib/db";

export type DevelopmentDatabaseSyncDirection = "pull" | "push";

export type DevelopmentDatabaseSyncResult = {
  direction: DevelopmentDatabaseSyncDirection;
  tableCount: number;
  rowCount: number;
  skippedRowCount: number;
  completedAt: string;
};

export type DatabaseBackup = {
  format: "bc-demoenv-database-backup";
  version: 1;
  createdAt: string;
  tables: Array<{
    name: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
  }>;
};

export type DatabaseRestoreResult = {
  tableCount: number;
  rowCount: number;
  skippedRowCount: number;
  completedAt: string;
};

const applicationTables = [
  "notes",
  "bigcommerce_environments",
  "catalog_snapshots",
  "catalog_snapshot_events",
  "catalog_snapshot_tags",
  "application_events",
  "favorites",
  "collection_view_preferences",
  "user_profiles",
  "catalog_operations",
  "catalog_schedules",
  "catalog_snapshot_capture_state",
  "catalog_snapshot_capture_products",
] as const;

type TableCopy = {
  name: (typeof applicationTables)[number];
  columns: string[];
  rows: Array<Record<string, unknown>>;
};

type DatabaseSyncAuditInput = {
  direction: DevelopmentDatabaseSyncDirection;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  tableCount?: number;
  rowCount?: number;
  skippedRowCount?: number;
  error?: string;
};

let syncInFlight = false;

type EncodedDatabaseValue =
  | null
  | string
  | number
  | boolean
  | { $type: "bigint"; value: string }
  | { $type: "bytes"; value: string };

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function createRemoteClient() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url) throw new Error("TURSO_DATABASE_URL is not configured.");
  return createClient({ url, authToken: authToken || undefined });
}

function databaseLabels(direction: DevelopmentDatabaseSyncDirection) {
  return direction === "pull"
    ? { source: "Turso", destination: "Local SQLite" }
    : { source: "Local SQLite", destination: "Turso" };
}

async function recordDatabaseSyncOperation(
  client: Client,
  userId: string,
  input: DatabaseSyncAuditInput,
) {
  const labels = databaseLabels(input.direction);
  const completed = input.status === "completed";
  const currentStep = completed
    ? `${input.direction === "pull" ? "Pulled" : "Pushed"} ${labels.source} to ${labels.destination}`
    : `Database ${input.direction} failed`;
  const payload = {
    direction: input.direction,
    source: labels.source,
    destination: labels.destination,
    initiatedFrom: "Settings / Profile",
  };
  const result = completed
    ? {
        direction: input.direction,
        source: labels.source,
        destination: labels.destination,
        tableCount: input.tableCount ?? 0,
        rowCount: input.rowCount ?? 0,
        skippedRowCount: input.skippedRowCount ?? 0,
        completedAt: input.completedAt,
      }
    : {
        direction: input.direction,
        source: labels.source,
        destination: labels.destination,
        failedAt: input.completedAt,
      };

  await client.execute({
    sql: `
      INSERT INTO catalog_operations (
        user_id, kind, environment_id, channel_id, snapshot_id,
        operation_key, status, current_step, step_index, total_steps,
        payload_json, result_json, error, workflow_run_id, created_at, updated_at
      ) VALUES (?, 'database_sync', NULL, NULL, NULL, NULL, ?, ?, ?, 1, ?, ?, ?, NULL, ?, ?)
    `,
    args: [
      userId,
      input.status,
      currentStep,
      completed ? 1 : 0,
      JSON.stringify(payload),
      JSON.stringify(result),
      input.error ?? null,
      input.startedAt,
      input.completedAt,
    ],
  });
}

async function recordDatabaseSyncOnBoth(
  local: Client | null,
  remote: Client,
  userId: string,
  input: DatabaseSyncAuditInput,
) {
  const localResult = local
    ? await recordDatabaseSyncOperation(local, userId, input)
        .then(() => ({ status: "fulfilled" as const }))
        .catch((reason: unknown) => ({ status: "rejected" as const, reason }))
    : { status: "rejected" as const, reason: new Error("Local SQLite was unavailable.") };
  const remoteResult = await recordDatabaseSyncOperation(remote, userId, input)
    .then(() => ({ status: "fulfilled" as const }))
    .catch((reason: unknown) => ({ status: "rejected" as const, reason }));

  // The active development UI reads local SQLite, so a missing local audit row is
  // surfaced. A remote audit failure must not turn a completed mirror into a failed
  // sync; the local row still preserves the attempt for Operations.
  if (localResult.status === "rejected") throw localResult.reason;
  return remoteResult;
}

async function getTableColumns(client: Client, table: string) {
  const result = await client.execute(`PRAGMA table_info(${quoteIdentifier(table)})`);
  return result.rows.map((row) => String(row.name));
}

async function assertCompatibleSchemas(local: Client, remote: Client) {
  for (const table of applicationTables) {
    const [localColumns, remoteColumns] = await Promise.all([
      getTableColumns(local, table),
      getTableColumns(remote, table),
    ]);
    if (!localColumns.length || !remoteColumns.length) {
      throw new Error(
        `The ${table} table is missing from ${!localColumns.length ? "the local database" : "Turso"}. Start both applications on the current code before syncing.`,
      );
    }
    const localSet = new Set(localColumns);
    const remoteSet = new Set(remoteColumns);
    const mismatch = localColumns.some((column) => !remoteSet.has(column))
      || remoteColumns.some((column) => !localSet.has(column));
    if (mismatch) {
      throw new Error(
        `The ${table} schema differs between local SQLite and Turso. Apply the current schema to both databases before syncing.`,
      );
    }
  }
}

async function assertNoActiveOperations(client: Client, label: string) {
  const result = await client.execute(`
    SELECT COUNT(*) AS active_count
    FROM catalog_operations
    WHERE status IN ('queued', 'running')
  `);
  const count = Number(result.rows[0]?.active_count ?? 0);
  if (count > 0) {
    throw new Error(
      `${label} has ${count} active catalog operation${count === 1 ? "" : "s"}. Wait for them to finish or cancel them before syncing.`,
    );
  }
}

async function readDatabase(client: Client): Promise<TableCopy[]> {
  const tables: TableCopy[] = [];
  for (const name of applicationTables) {
    const columns = await getTableColumns(client, name);
    const selection = columns.map(quoteIdentifier).join(", ");
    const result = await client.execute(
      `SELECT ${selection} FROM ${quoteIdentifier(name)}`,
    );
    tables.push({
      name,
      columns,
      rows: result.rows.map((row) => ({ ...row } as Record<string, unknown>)),
    });
  }
  return tables;
}

function prepareSourceTablesForSync(sourceTables: TableCopy[]) {
  let skippedRowCount = 0;
  const tables = sourceTables.map((table) => {
    if (table.name !== "notes") return table;

    // Authentication was introduced after the original notes table. SQLite
    // could only add user_id as a nullable column to that legacy table, so old
    // rows can remain ownerless in Turso even though every current database and
    // application write requires an owner. Never guess an owner during a
    // whole-database mirror: omit those inaccessible legacy rows instead.
    const rows = table.rows.filter((row) => {
      const userId = row.user_id;
      const hasOwner = typeof userId === "string" && userId.trim().length > 0;
      if (!hasOwner) skippedRowCount += 1;
      return hasOwner;
    });

    return { ...table, rows };
  });

  return { tables, skippedRowCount };
}

function getInsertStatements(table: TableCopy): InStatement[] {
  if (!table.rows.length) return [];
  const columns = table.columns.map(quoteIdentifier).join(", ");
  const placeholders = table.columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${quoteIdentifier(table.name)} (${columns}) VALUES (${placeholders})`;
  return table.rows.map((row) => ({
    sql,
    args: table.columns.map((column) => row[column] as InValue),
  }));
}

async function replaceDatabase(destination: Client, sourceTables: TableCopy[]) {
  const transaction = await destination.transaction("write");
  try {
    for (const table of [...applicationTables].reverse()) {
      await transaction.execute(`DELETE FROM ${quoteIdentifier(table)}`);
    }

    for (const table of sourceTables) {
      const statements = getInsertStatements(table);
      for (let index = 0; index < statements.length; index += 100) {
        await transaction.batch(statements.slice(index, index + 100));
      }
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  } finally {
    transaction.close();
  }
}

function assertDatabaseMaintenanceAvailable() {
  if (syncInFlight) {
    throw new Error("Another database maintenance action is already running in this application instance.");
  }
}

function encodeDatabaseValue(value: unknown): EncodedDatabaseValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return { $type: "bigint", value: value.toString() };
  }
  if (value instanceof Uint8Array) {
    return { $type: "bytes", value: Buffer.from(value).toString("base64") };
  }
  if (value instanceof ArrayBuffer) {
    return { $type: "bytes", value: Buffer.from(value).toString("base64") };
  }
  throw new Error(`The database contains an unsupported value type: ${typeof value}.`);
}

function decodeDatabaseValue(value: unknown): InValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object" && value !== null && "$type" in value && "value" in value) {
    const tagged = value as { $type: unknown; value: unknown };
    if (tagged.$type === "bigint" && typeof tagged.value === "string" && /^-?\d+$/.test(tagged.value)) {
      return BigInt(tagged.value);
    }
    if (tagged.$type === "bytes" && typeof tagged.value === "string") {
      return new Uint8Array(Buffer.from(tagged.value, "base64"));
    }
  }
  throw new Error("The backup contains an unsupported database value.");
}

function encodeTable(table: TableCopy) {
  return {
    name: table.name,
    columns: table.columns,
    rows: table.rows.map((row) => Object.fromEntries(
      table.columns.map((column) => [column, encodeDatabaseValue(row[column])]),
    )),
  };
}

async function validateAndDecodeBackup(
  client: Client,
  input: unknown,
): Promise<TableCopy[]> {
  if (!input || typeof input !== "object") throw new Error("The selected file is not a database backup.");
  const backup = input as Partial<DatabaseBackup>;
  if (backup.format !== "bc-demoenv-database-backup" || backup.version !== 1 || !Array.isArray(backup.tables)) {
    throw new Error("The selected file is not a supported bc-demoenv database backup.");
  }

  const expectedNames = new Set<string>(applicationTables);
  const providedNames = backup.tables.map((table) => table?.name);
  if (
    providedNames.length !== applicationTables.length
    || new Set(providedNames).size !== applicationTables.length
    || providedNames.some((name) => typeof name !== "string" || !expectedNames.has(name))
  ) {
    throw new Error("The backup does not contain exactly the application tables expected by this version.");
  }

  const decoded: TableCopy[] = [];
  for (const name of applicationTables) {
    const table = backup.tables.find((candidate) => candidate.name === name);
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
      throw new Error(`The ${name} table is malformed in the backup.`);
    }
    const currentColumns = await getTableColumns(client, name);
    const suppliedColumns = table.columns;
    if (
      suppliedColumns.length !== currentColumns.length
      || new Set(suppliedColumns).size !== currentColumns.length
      || currentColumns.some((column) => !suppliedColumns.includes(column))
    ) {
      throw new Error(`The ${name} schema in the backup is incompatible with this application version.`);
    }
    const rows = table.rows.map((row, rowIndex) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(`Row ${rowIndex + 1} in ${name} is malformed.`);
      }
      return Object.fromEntries(
        currentColumns.map((column) => {
          if (!(column in row)) throw new Error(`Row ${rowIndex + 1} in ${name} is missing ${column}.`);
          return [column, decodeDatabaseValue(row[column])];
        }),
      );
    });
    decoded.push({ name, columns: currentColumns, rows });
  }
  return decoded;
}

export async function createDatabaseBackup(): Promise<DatabaseBackup> {
  assertDatabaseMaintenanceAvailable();
  syncInFlight = true;
  try {
    const database = await getActiveDatabaseClientForMaintenance();
    const label = getDevelopmentDatabaseStatus().activeDatabase === "local" ? "Local SQLite" : "Turso";
    await assertNoActiveOperations(database, label);
    const tables = await readDatabase(database);
    return {
      format: "bc-demoenv-database-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      tables: tables.map(encodeTable),
    };
  } finally {
    syncInFlight = false;
  }
}

export async function restoreDatabaseBackup(
  input: unknown,
): Promise<DatabaseRestoreResult> {
  assertDatabaseMaintenanceAvailable();
  syncInFlight = true;
  try {
    const database = await getActiveDatabaseClientForMaintenance();
    const label = getDevelopmentDatabaseStatus().activeDatabase === "local" ? "Local SQLite" : "Turso";
    await assertNoActiveOperations(database, label);
    const decodedTables = await validateAndDecodeBackup(database, input);
    const sourceImage = prepareSourceTablesForSync(decodedTables);
    await assertNoActiveOperations(database, label);
    await replaceDatabase(database, sourceImage.tables);
    return {
      tableCount: sourceImage.tables.length,
      rowCount: sourceImage.tables.reduce((total, table) => total + table.rows.length, 0),
      skippedRowCount: sourceImage.skippedRowCount,
      completedAt: new Date().toISOString(),
    };
  } finally {
    syncInFlight = false;
  }
}

export async function syncDevelopmentDatabases(
  direction: DevelopmentDatabaseSyncDirection,
  userId: string,
): Promise<DevelopmentDatabaseSyncResult> {
  const status = getDevelopmentDatabaseStatus();
  if (process.env.NODE_ENV !== "development" || !status.enabled || status.activeDatabase !== "local") {
    throw new Error(
      "Database sync is available only in development when LOCAL_DATABASE_URL and TURSO_DATABASE_URL are configured.",
    );
  }
  if (!status.localUrl?.startsWith("file:")) {
    throw new Error("LOCAL_DATABASE_URL must use a file: SQLite URL.");
  }
  if (syncInFlight) throw new Error("Another database sync is already running in this dev server.");

  syncInFlight = true;
  const startedAt = new Date().toISOString();
  const remote = createRemoteClient();
  let local: Client | null = null;
  try {
    let result: DevelopmentDatabaseSyncResult;
    try {
      local = await getActiveDatabaseClientForDevelopmentSync();
      await assertCompatibleSchemas(local, remote);
      await Promise.all([
        assertNoActiveOperations(local, "Local SQLite"),
        assertNoActiveOperations(remote, "Turso"),
      ]);

      const source = direction === "pull" ? remote : local;
      const destination = direction === "pull" ? local : remote;
      const sourceImage = prepareSourceTablesForSync(await readDatabase(source));
      const sourceTables = sourceImage.tables;

      // Recheck just before replacement so a workflow cannot be copied mid-flight.
      await Promise.all([
        assertNoActiveOperations(local, "Local SQLite"),
        assertNoActiveOperations(remote, "Turso"),
      ]);
      await replaceDatabase(destination, sourceTables);

      result = {
        direction,
        tableCount: sourceTables.length,
        rowCount: sourceTables.reduce((total, table) => total + table.rows.length, 0),
        skippedRowCount: sourceImage.skippedRowCount,
        completedAt: new Date().toISOString(),
      } satisfies DevelopmentDatabaseSyncResult;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : "The database sync failed.";
      await recordDatabaseSyncOnBoth(local, remote, userId, {
        direction,
        status: "failed",
        startedAt,
        completedAt,
        error: message,
      }).catch(() => undefined);
      throw error;
    }

    await recordDatabaseSyncOnBoth(local, remote, userId, {
      ...result,
      status: "completed",
      startedAt,
    });
    return result;
  } finally {
    remote.close();
    syncInFlight = false;
  }
}
