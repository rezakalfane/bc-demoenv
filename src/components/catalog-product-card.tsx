import Image from "next/image";
import type { CatalogProduct } from "@/lib/catalog-types";

export function CatalogProductCard({
  product,
  priceFormatter,
}: {
  product: CatalogProduct;
  priceFormatter: Intl.NumberFormat;
}) {
  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-black/9 bg-white/70 shadow-[0_10px_30px_rgba(0,0,0,0.035)] backdrop-blur transition hover:-translate-y-0.5 hover:border-emerald-500/30 hover:shadow-[0_14px_35px_rgba(0,0,0,0.07)] dark:border-white/9 dark:bg-white/4">
      <div className="relative aspect-square overflow-hidden bg-black/4 dark:bg-white/5">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(min-width: 1280px) 140px, (min-width: 768px) 25vw, 50vw"
            className="object-contain p-3 transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full items-center justify-center px-4 text-center text-xs text-black/30 dark:text-white/30">
            No image
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 tracking-tight">
          {product.name}
        </h3>
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-black/45 dark:text-white/45">
          {product.description || "No description available."}
        </p>
        <p className="mt-auto pt-4 text-sm font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
          {product.price === null
            ? "Price unavailable"
            : priceFormatter.format(product.price)}
        </p>
      </div>
    </article>
  );
}
