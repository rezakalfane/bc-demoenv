"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CatalogLocale } from "@/lib/catalog-localization";

function localeLabel(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function CatalogLocaleSelector({
  locales,
  activeLocale,
}: {
  locales: CatalogLocale[];
  activeLocale: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="sr-only">Catalog locale</span>
      <select
        value={activeLocale}
        onChange={(event) => {
          const query = new URLSearchParams(searchParams.toString());
          query.set("locale", event.target.value);
          router.replace(`${pathname}?${query.toString()}`, { scroll: false });
        }}
        className="h-7 max-w-44 rounded-lg border border-black/10 bg-white/70 px-2 text-xs font-medium text-black/65 outline-none transition focus:border-emerald-500 dark:border-white/10 dark:bg-white/5 dark:text-white/65"
      >
        {locales.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {localeLabel(locale.code)} ({locale.code}){locale.isDefault ? " · Default" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
