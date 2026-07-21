import { NextResponse } from "next/server";

import { getCatalogRestoreDestinations } from "@/lib/catalog-restore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const destinations = await getCatalogRestoreDestinations();
    return NextResponse.json(
      { destinations },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "The live BigCommerce destinations could not be loaded.",
      },
      { status: 500 },
    );
  }
}
