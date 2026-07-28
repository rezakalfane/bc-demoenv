"use client";

import Link from "next/link";
import { useState } from "react";
import type { CatalogCategory } from "@/lib/catalog-types";
import { useAppI18n } from "@/components/app-i18n-provider";

function findAncestorIds(
  categories: CatalogCategory[],
  selectedCategoryId: number | null,
  ancestors: number[] = [],
): number[] {
  if (!selectedCategoryId) {
    return [];
  }

  for (const category of categories) {
    if (category.id === selectedCategoryId) {
      return ancestors;
    }

    const path = findAncestorIds(category.children, selectedCategoryId, [
      ...ancestors,
      category.id,
    ]);

    if (path.length > 0) {
      return path;
    }
  }

  return [];
}

function CategoryBranch({
  categories,
  basePath,
  selectedCategoryId,
  expandedIds,
  onToggle,
  locale,
}: {
  categories: CatalogCategory[];
  basePath: string;
  selectedCategoryId: number | null;
  expandedIds: Set<number>;
  onToggle: (categoryId: number) => void;
  locale?: string;
}) {
  const { t } = useAppI18n();
  return (
    <ul className="space-y-1">
      {categories.map((category) => {
        const hasChildren = category.children.length > 0;
        const isExpanded = expandedIds.has(category.id);
        const isSelected = selectedCategoryId === category.id;
        const childrenId = `category-${category.id}-children`;

        return (
          <li key={category.id}>
            <div
              className={`flex min-w-0 items-center rounded-lg transition ${
                isSelected
                  ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300"
                  : "text-black/65 hover:bg-black/4 dark:text-white/65 dark:hover:bg-white/5"
              }`}
            >
              {hasChildren ? (
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={childrenId}
                  aria-label={t("{action} {target}", { action: t(isExpanded ? "Collapse" : "Expand"), target: category.name })}
                  onClick={() => onToggle(category.id)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-black/40 transition hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600 dark:text-white/40 dark:hover:text-emerald-300"
                >
                  <span
                    aria-hidden="true"
                    className={`text-base transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  >
                    ›
                  </span>
                </button>
              ) : (
                <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center">
                  <span className="size-1.5 rounded-full bg-emerald-500/60" />
                </span>
              )}

              <Link
                href={`${basePath}?${new URLSearchParams({
                  category: String(category.id),
                  ...(locale ? { locale } : {}),
                }).toString()}`}
                prefetch={false}
                scroll={false}
                aria-current={isSelected ? "page" : undefined}
                className="min-w-0 flex-1 truncate rounded-r-lg py-2 pr-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600"
                title={category.name}
              >
                {category.name}
              </Link>
            </div>

            {hasChildren && isExpanded ? (
              <div
                id={childrenId}
                className="ml-4 border-l border-black/10 pl-2 dark:border-white/10"
              >
                <CategoryBranch
                  categories={category.children}
                  basePath={basePath}
                  selectedCategoryId={selectedCategoryId}
                  expandedIds={expandedIds}
                  onToggle={onToggle}
                  locale={locale}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function CatalogCategoryTree({
  categories,
  basePath,
  selectedCategoryId,
  locale,
}: {
  categories: CatalogCategory[];
  basePath: string;
  selectedCategoryId: number | null;
  locale?: string;
}) {
  const [expandedIds, setExpandedIds] = useState(
    () =>
      new Set([
        ...categories.map((category) => category.id),
        ...findAncestorIds(categories, selectedCategoryId),
      ]),
  );

  function toggleCategory(categoryId: number) {
    setExpandedIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(categoryId)) {
        nextIds.delete(categoryId);
      } else {
        nextIds.add(categoryId);
      }

      return nextIds;
    });
  }

  return (
    <nav aria-label="Category tree">
      <Link
        href={locale ? `${basePath}?locale=${encodeURIComponent(locale)}` : basePath}
        prefetch={false}
        scroll={false}
        aria-current={selectedCategoryId === null ? "page" : undefined}
        className={`mb-2 flex rounded-lg px-2.5 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600 ${
          selectedCategoryId === null
            ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300"
            : "text-black/65 hover:bg-black/4 dark:text-white/65 dark:hover:bg-white/5"
        }`}
      >
        All products
      </Link>
      <CategoryBranch
        categories={categories}
        basePath={basePath}
        selectedCategoryId={selectedCategoryId}
        expandedIds={expandedIds}
        onToggle={toggleCategory}
        locale={locale}
      />
    </nav>
  );
}
