export type CatalogCategory = {
  id: number;
  name: string;
  children: CatalogCategory[];
};

export type CatalogProduct = {
  id: number;
  name: string;
  description: string;
  price: number | null;
  imageUrl: string | null;
  categoryIds: number[];
};

export type ProductDetailRecord = {
  data: Record<string, unknown>;
  metafields: unknown[];
  variantMetafields: {
    variantId: number;
    data: unknown[];
  }[];
};
