import type { CatalogCategory, CatalogProduct } from "@/lib/catalog-types";

export function findCatalogCategory(
  categories: CatalogCategory[],
  categoryId: number,
): CatalogCategory | null {
  for (const category of categories) {
    if (category.id === categoryId) {
      return category;
    }

    const match = findCatalogCategory(category.children, categoryId);

    if (match) {
      return match;
    }
  }

  return null;
}

function collectCategoryIds(category: CatalogCategory) {
  const ids = new Set<number>([category.id]);

  for (const child of category.children) {
    for (const categoryId of collectCategoryIds(child)) {
      ids.add(categoryId);
    }
  }

  return ids;
}

export function filterProductsByCategory(
  products: CatalogProduct[],
  category: CatalogCategory | null,
) {
  if (!category) {
    return products;
  }

  const categoryIds = collectCategoryIds(category);
  return products.filter((product) =>
    product.categoryIds.some((categoryId) => categoryIds.has(categoryId)),
  );
}
