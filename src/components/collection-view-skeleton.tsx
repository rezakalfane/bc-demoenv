function ToolbarSkeleton({ extraButton = false }: { extraButton?: boolean }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="h-9 w-full max-w-sm rounded-xl bg-black/5 dark:bg-white/8" />
      <div className="flex shrink-0 gap-1.5">
        {Array.from({ length: extraButton ? 3 : 2 }, (_, index) => (
          <div
            key={index}
            className="size-8 rounded-lg bg-black/5 dark:bg-white/8"
          />
        ))}
      </div>
    </div>
  );
}

function TableSkeleton({
  columns,
  rows,
}: {
  columns: number;
  rows: number;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/8 bg-white/55 dark:border-white/8 dark:bg-white/3">
      <div className="overflow-x-auto">
        <div style={{ minWidth: `${Math.max(columns * 112, 640)}px` }}>
          <div
            className="grid gap-4 border-b border-black/8 bg-black/[0.025] px-3 py-3 dark:border-white/8 dark:bg-white/[0.025]"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(5rem, 1fr))` }}
          >
            {Array.from({ length: columns }, (_, index) => (
              <div key={index} className="h-3 rounded bg-black/7 dark:bg-white/10" />
            ))}
          </div>
          <div className="divide-y divide-black/6 dark:divide-white/6">
            {Array.from({ length: rows }, (_, rowIndex) => (
              <div
                key={rowIndex}
                className="grid gap-4 px-3 py-3"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(5rem, 1fr))` }}
              >
                {Array.from({ length: columns }, (_, columnIndex) => (
                  <div
                    key={columnIndex}
                    className={`h-3 rounded bg-black/5 dark:bg-white/8 ${columnIndex === 0 ? "max-w-40" : "max-w-24"}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CollectionViewSkeleton({
  collectionId,
  cardCount = 3,
  tableColumns = 6,
  tableRows = 6,
  cardsClassName = "grid gap-5 md:grid-cols-2 xl:grid-cols-3",
  cardClassName = "h-72 rounded-3xl bg-black/4 dark:bg-white/5",
  sharedToggle = false,
}: {
  collectionId: string;
  cardCount?: number;
  tableColumns?: number;
  tableRows?: number;
  cardsClassName?: string;
  cardClassName?: string;
  sharedToggle?: boolean;
}) {
  const supportsFourColumns = [
    "dashboard-environments",
    "settings-environments",
    "environment-channels",
    "snapshot-series",
  ].includes(collectionId);

  return (
    <div className="animate-pulse">
      <ToolbarSkeleton extraButton={sharedToggle} />
      <div className="collection-view-skeleton-table">
        <TableSkeleton columns={tableColumns} rows={tableRows} />
      </div>
      <div className="collection-view-skeleton-cards">
        <div className={`${supportsFourColumns ? "collection-four-column-cards " : ""}${cardsClassName}`}>
          {Array.from({ length: cardCount }, (_, index) => (
            <div key={index} className={cardClassName} />
          ))}
        </div>
      </div>
    </div>
  );
}
