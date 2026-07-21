import { AppShell } from "@/components/app-shell";
import { CollectionPreferencesProvider } from "@/components/collection-preferences-provider";
import { ConfirmationProvider } from "@/components/confirmation-provider";
import { LocalSchedulerDispatcher } from "@/components/local-scheduler-dispatcher";
import { requireAppUser } from "@/lib/auth";
import { getCollectionViewPreferences, getUserProfile } from "@/lib/db";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireAppUser();
  const [collectionPreferences, profile] = await Promise.all([
    getCollectionViewPreferences(user.id),
    getUserProfile(user.id),
  ]);

  return (
    <CollectionPreferencesProvider initialPreferences={collectionPreferences}>
      <ConfirmationProvider>
        <LocalSchedulerDispatcher enabled={profile.localSchedulerEnabled} />
        <AppShell userId={user.id} userEmail={user.email}>{children}</AppShell>
      </ConfirmationProvider>
    </CollectionPreferencesProvider>
  );
}
