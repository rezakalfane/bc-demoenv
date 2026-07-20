"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ClientCollectionPreference = {
  viewMode: "cards" | "table";
  showShared: boolean;
};

type CollectionPreferencesContextValue = {
  preferences: Record<string, ClientCollectionPreference>;
  updatePreference: (
    collectionId: string,
    patch: Partial<ClientCollectionPreference>,
  ) => void;
};

const defaultPreference: ClientCollectionPreference = {
  viewMode: "cards",
  showShared: true,
};

const CollectionPreferencesContext =
  createContext<CollectionPreferencesContextValue | null>(null);

export function CollectionPreferencesProvider({
  initialPreferences,
  children,
}: {
  initialPreferences: Record<string, ClientCollectionPreference>;
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const updatePreference = useCallback(
    (collectionId: string, patch: Partial<ClientCollectionPreference>) => {
      setPreferences((current) => ({
        ...current,
        [collectionId]: {
          ...(current[collectionId] ?? defaultPreference),
          ...patch,
        },
      }));
    },
    [],
  );
  const value = useMemo(
    () => ({ preferences, updatePreference }),
    [preferences, updatePreference],
  );

  return (
    <CollectionPreferencesContext value={value}>
      {children}
    </CollectionPreferencesContext>
  );
}

export function useCollectionPreference(collectionId: string) {
  const context = useContext(CollectionPreferencesContext);
  return {
    preference: context?.preferences[collectionId] ?? defaultPreference,
    updatePreference: context?.updatePreference ?? (() => undefined),
  };
}
