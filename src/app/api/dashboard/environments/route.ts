import { NextResponse } from "next/server";
import { getEnvironmentDashboards } from "@/lib/bigcommerce";

export async function GET() {
  const environments = await getEnvironmentDashboards();

  return NextResponse.json(
    { environments },
    { headers: { "Cache-Control": "no-store" } },
  );
}
