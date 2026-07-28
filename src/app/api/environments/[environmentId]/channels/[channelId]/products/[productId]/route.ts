import { getChannelProductDetails } from "@/lib/bigcommerce-catalog";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      environmentId: string;
      channelId: string;
      productId: string;
    }>;
  },
) {
  const routeParams = await params;
  const environmentId = Number(routeParams.environmentId);
  const channelId = Number(routeParams.channelId);
  const productId = Number(routeParams.productId);

  if (
    !Number.isSafeInteger(environmentId) ||
    environmentId < 1 ||
    !Number.isSafeInteger(channelId) ||
    channelId < 1 ||
    !Number.isSafeInteger(productId) ||
    productId < 1
  ) {
    return Response.json(
      { error: "Invalid environment, channel, or product ID." },
      { status: 400 },
    );
  }

  try {
    const record = await getChannelProductDetails(
      environmentId,
      channelId,
      productId,
    );
    if (!record) {
      return Response.json(
        { error: "BigCommerce product not found for this channel." },
        { status: 404 },
      );
    }

    return Response.json(
      { record },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Unable to load product details from BigCommerce." },
      { status: 502 },
    );
  }
}
