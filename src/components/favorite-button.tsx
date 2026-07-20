"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import {
  toggleFavorite,
  type FavoriteTarget,
} from "@/app/(app)/favorite-actions";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" />
    </svg>
  );
}

export function FavoriteButton({
  target,
  initialFavorite,
  label,
  compact = false,
}: {
  target: FavoriteTarget;
  initialFavorite: boolean;
  label: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [favorite, setOptimisticFavorite] = useOptimistic(
    initialFavorite,
    (_currentFavorite, nextFavorite: boolean) => nextFavorite,
  );
  const [pending, startTransition] = useTransition();

  const actionLabel = favorite ? `Remove ${label} from favorites` : `Add ${label} to favorites`;

  return (
    <button
      type="button"
      aria-label={actionLabel}
      aria-pressed={favorite}
      title={actionLabel}
      disabled={pending}
      className={`inline-flex shrink-0 items-center justify-center self-center border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-wait disabled:opacity-60 ${compact ? "size-6 rounded-md" : "size-7 rounded-full"} ${
        favorite
          ? "border-amber-500/35 bg-amber-500/12 text-amber-600 hover:bg-amber-500/18 dark:text-amber-300"
          : "border-black/10 bg-white/60 text-black/35 hover:border-amber-500/35 hover:text-amber-600 dark:border-white/10 dark:bg-white/5 dark:text-white/35 dark:hover:text-amber-300"
      }`}
      onClick={() => {
        startTransition(async () => {
          setOptimisticFavorite(!favorite);
          const result = await toggleFavorite(target);
          if (!result.error && result.isFavorite !== null) {
            router.refresh();
          }
        });
      }}
    >
      <StarIcon filled={favorite} />
    </button>
  );
}
