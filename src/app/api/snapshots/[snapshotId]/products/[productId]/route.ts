import { getCatalogSnapshotView } from "@/lib/catalog-snapshots";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ snapshotId: string; productId: string }>;
  },
) {
  const routeParams = await params;
  const snapshotId = Number(routeParams.snapshotId);
  const productId = Number(routeParams.productId);

  if (
    !Number.isSafeInteger(snapshotId) ||
    snapshotId < 1 ||
    !Number.isSafeInteger(productId) ||
    productId < 1
  ) {
    return Response.json({ error: "Invalid snapshot or product ID." }, { status: 400 });
  }

  const snapshot = await getCatalogSnapshotView(snapshotId);
  if (!snapshot) {
    return Response.json({ error: "Snapshot not found." }, { status: 404 });
  }

  const record = snapshot.productRecords.find(
    (candidate) => Number(candidate.data.id) === productId,
  );
  if (!record) {
    return Response.json({ error: "Captured product not found." }, { status: 404 });
  }

  return Response.json(
    { record },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
