import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth";
import { getAccessibleCatalogSnapshot } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

const sensitiveKeyPattern = /(?:^|[_-])(?:access[_-]?token|api[_-]?key|secret|password|private[_-]?key|credentials?|authorization)(?:$|[_-])/i;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function sanitizeCapturedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeCapturedValue);
  }

  const record = asRecord(value);
  if (!record) return value;

  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[redacted]" : sanitizeCapturedValue(entry),
    ]),
  );
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ snapshotId: string }> },
) {
  const user = await requireAppUser();
  const snapshotId = Number((await params).snapshotId);

  if (!Number.isSafeInteger(snapshotId) || snapshotId < 1) {
    return NextResponse.json({ error: "Invalid snapshot ID." }, { status: 400 });
  }

  const snapshot = await getAccessibleCatalogSnapshot(user.id, snapshotId);
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot not found." }, { status: 404 });
  }

  try {
    const manifest = asRecord(JSON.parse(snapshot.payloadJson));
    const configuration = asRecord(manifest?.configuration);

    return NextResponse.json(
      { configuration: configuration ? sanitizeCapturedValue(configuration) : null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "This snapshot payload is invalid." },
      { status: 422, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
