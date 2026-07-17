import "server-only";

import { createClient, type Client } from "@libsql/client";
import { encryptSecret } from "@/lib/secret-encryption";

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
  })();

  return schemaReady;
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
