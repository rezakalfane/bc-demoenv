import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth";
import { assertCanMaintainDatabase } from "@/lib/database-maintenance-auth";
import {
  createDatabaseBackup,
  restoreDatabaseBackup,
} from "@/lib/development-database-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "The database action failed." },
    { status },
  );
}

async function authorize() {
  const user = await requireAppUser();
  assertCanMaintainDatabase(user);
}

export async function GET() {
  try {
    await authorize();
    const backup = await createDatabaseBackup();
    const stamp = backup.createdAt.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    return new Response(JSON.stringify(backup), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="bc-demoenv-${stamp}.json"`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    const forbidden = error instanceof Error && error.message.includes("DATABASE_BACKUP_ALLOWED_EMAILS");
    return errorResponse(error, forbidden ? 403 : 400);
  }
}

export async function POST(request: Request) {
  try {
    await authorize();
    const backup = await request.json() as unknown;
    const result = await restoreDatabaseBackup(backup);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const forbidden = error instanceof Error && error.message.includes("DATABASE_BACKUP_ALLOWED_EMAILS");
    return errorResponse(error, forbidden ? 403 : 400);
  }
}
