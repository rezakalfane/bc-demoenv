import { AppShell } from "@/components/app-shell";
import { CollectionPreferencesProvider } from "@/components/collection-preferences-provider";
import { requireAppUser } from "@/lib/auth";
import { getCollectionViewPreferences } from "@/lib/db";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireAppUser();
  const collectionPreferences = await getCollectionViewPreferences(user.id);

  return (
    <CollectionPreferencesProvider initialPreferences={collectionPreferences}>
      <AppShell userId={user.id} userEmail={user.email}>{children}</AppShell>
    </CollectionPreferencesProvider>
  );
}
