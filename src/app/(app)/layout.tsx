import { AppShell } from "@/components/app-shell";
import { AppLocaleSynchronizer } from "@/components/app-i18n-provider";
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
    getUserProfile(user.id, {
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.imageUrl,
    }),
  ]);

  return (
    <CollectionPreferencesProvider initialPreferences={collectionPreferences}>
      <ConfirmationProvider>
        <AppLocaleSynchronizer locale={profile.language} />
        <LocalSchedulerDispatcher
          enabled={profile.localSchedulerEnabled}
          interval={profile.localSchedulerInterval}
        />
        <AppShell
          userId={user.id}
          userEmail={user.email}
          userFirstName={profile.firstName}
          userLastName={profile.lastName}
          userImageUrl={profile.avatar}
        >
          {children}
        </AppShell>
      </ConfirmationProvider>
    </CollectionPreferencesProvider>
  );
}
