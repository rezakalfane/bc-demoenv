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
