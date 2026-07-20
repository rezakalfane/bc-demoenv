import Link from "next/link";

export function OperationsSubnavigation({ active }: { active: "operations" | "workflows" }) {
  return (
    <nav aria-label="Operations sections" className="mt-5 flex w-fit rounded-xl border border-black/8 bg-black/[0.025] p-1 dark:border-white/8 dark:bg-white/[0.025]">
      {[
        { id: "operations" as const, href: "/operations", label: "Activity ledger" },
        { id: "workflows" as const, href: "/operations/workflows", label: "Workflows" },
      ].map((item) => (
        <Link
          key={item.id}
          href={item.href}
          aria-current={active === item.id ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            active === item.id
              ? "bg-white text-black shadow-sm dark:bg-white/10 dark:text-white"
              : "text-black/45 hover:text-black dark:text-white/45 dark:hover:text-white"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
