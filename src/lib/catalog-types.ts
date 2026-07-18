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
