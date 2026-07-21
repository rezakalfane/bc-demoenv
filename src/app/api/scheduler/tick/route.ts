import { NextResponse } from "next/server";
import { dispatchDueCatalogSchedules } from "@/lib/catalog-scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await dispatchDueCatalogSchedules();
  return NextResponse.json({ dispatched: results.length, results });
}
