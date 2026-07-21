import { Suspense } from "react";
import { CollectionViewSkeleton } from "@/components/collection-view-skeleton";
import { DashboardEnvironments } from "@/components/dashboard-environments";
import { requireAppUser } from "@/lib/auth";
import { getCachedEnvironmentDashboards } from "@/lib/bigcommerce";
import { getCollectionViewPreference } from "@/lib/db";

export const dynamic = "force-dynamic";

function DashboardSkeleton() {
  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-8 space-y-3 border-b border-black/10 pb-7 dark:border-white/10">
          <div className="h-4 w-24 animate-pulse rounded-full bg-black/8 dark:bg-white/8" />
          <div className="h-10 w-72 max-w-full animate-pulse rounded-xl bg-black/8 dark:bg-white/8" />
          <div className="h-5 w-[34rem] max-w-full animate-pulse rounded-lg bg-black/8 dark:bg-white/8" />
        </div>
        <CollectionViewSkeleton
          collectionId="dashboard-environments"
          tableColumns={8}
        />
      </div>
    </div>
  );
}

async function DashboardContent() {
  const user = await requireAppUser();
  const [environments, preference] = await Promise.all([
    getCachedEnvironmentDashboards(),
    getCollectionViewPreference(user.id, "dashboard-environments"),
  ]);

  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        <DashboardEnvironments
          initialEnvironments={environments}
          initialView={preference.viewMode}
        />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}
