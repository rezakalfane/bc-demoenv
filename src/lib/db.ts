import "server-only";

import { createClient, type Client } from "@libsql/client";

export type Note = {
  id: number;
  title: string;
  createdAt: string;
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
  schemaReady ??= getClient()
    .execute(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    .then(() => undefined);

  return schemaReady;
}

export async function getNotes(): Promise<Note[]> {
  await ensureSchema();
  const result = await getClient().execute(
    "SELECT id, title, created_at FROM notes ORDER BY id DESC LIMIT 50",
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    title: String(row.title),
    createdAt: `${String(row.created_at).replace(" ", "T")}Z`,
  }));
}

export async function addNote(title: string) {
  await ensureSchema();
  await getClient().execute({
    sql: "INSERT INTO notes (title) VALUES (?)",
    args: [title],
  });
}

export async function removeNote(id: number) {
  await ensureSchema();
  await getClient().execute({
    sql: "DELETE FROM notes WHERE id = ?",
    args: [id],
  });
}
