"use client";

import { useActionState, useEffect } from "react";
import {
  saveProfileAndPreferences,
  type ProfileActionState,
} from "@/app/(app)/settings/profile/actions";
import { useCollectionPreference } from "@/components/collection-preferences-provider";
import type { CollectionViewMode, UserProfile } from "@/lib/db";

const initialState: ProfileActionState = { status: "idle", message: "" };

function DisplayModeField({
  name,
  label,
  description,
  defaultValue,
}: {
  name: string;
  label: string;
  description: string;
  defaultValue: CollectionViewMode;
}) {
  return (
    <label className="rounded-2xl border border-black/10 bg-white/55 p-4 dark:border-white/10 dark:bg-white/3">
      <span className="block text-sm font-semibold">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-black/45 dark:text-white/45">{description}</span>
      <select name={name} defaultValue={defaultValue} className="mt-3 w-full rounded-xl border border-black/10 bg-background px-3 py-2 text-sm dark:border-white/10">
        <option value="cards">Cards</option>
        <option value="table">Compact table</option>
      </select>
    </label>
  );
}

export function ProfileSettingsForm({
  email,
  profile,
  initialPreferences,
}: {
  email: string;
  profile: UserProfile;
  initialPreferences: {
    environments: CollectionViewMode;
    channels: CollectionViewMode;
    snapshots: CollectionViewMode;
    settings: CollectionViewMode;
    showSharedSnapshots: boolean;
    sidebarCollapsed: boolean;
  };
}) {
  const [state, action, pending] = useActionState(saveProfileAndPreferences, initialState);
  const { updatePreference } = useCollectionPreference("app-shell");

  useEffect(() => {
    if (state.status !== "success" || !state.preferences) return;
    updatePreference("dashboard-environments", { viewMode: state.preferences.environments });
    updatePreference("environment-channels", { viewMode: state.preferences.channels });
    updatePreference("snapshot-series", {
      viewMode: state.preferences.snapshots,
      showShared: state.preferences.showSharedSnapshots,
    });
    updatePreference("settings-environments", { viewMode: state.preferences.settings });
    updatePreference("app-shell", { sidebarCollapsed: state.preferences.sidebarCollapsed });
  }, [state, updatePreference]);

  return (
    <form action={action} className="space-y-8">
      <section className="rounded-3xl border border-black/10 bg-white/65 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.04)] sm:p-7 dark:border-white/10 dark:bg-white/4">
        <h2 className="text-lg font-semibold">User profile</h2>
        <p className="mt-1 text-sm text-black/45 dark:text-white/45">Your timezone is used by Scheduler and its live clock.</p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label><span className="text-sm font-medium">First name</span><input name="firstName" defaultValue={profile.firstName} maxLength={80} autoComplete="given-name" className="mt-2 w-full rounded-xl border border-black/10 bg-background px-3 py-2.5 dark:border-white/10" /></label>
          <label><span className="text-sm font-medium">Last name</span><input name="lastName" defaultValue={profile.lastName} maxLength={80} autoComplete="family-name" className="mt-2 w-full rounded-xl border border-black/10 bg-background px-3 py-2.5 dark:border-white/10" /></label>
          <label><span className="text-sm font-medium">Email</span><input value={email} readOnly aria-readonly="true" className="mt-2 w-full cursor-not-allowed rounded-xl border border-black/10 bg-black/[0.035] px-3 py-2.5 text-black/55 dark:border-white/10 dark:bg-white/[0.035] dark:text-white/55" /></label>
          <label><span className="text-sm font-medium">Timezone</span><input name="timezone" defaultValue={profile.timezone} required list="profile-timezones" placeholder="Europe/Paris" className="mt-2 w-full rounded-xl border border-black/10 bg-background px-3 py-2.5 dark:border-white/10" /><datalist id="profile-timezones"><option value="Europe/Paris" /><option value="Europe/London" /><option value="America/New_York" /><option value="America/Chicago" /><option value="America/Los_Angeles" /><option value="Asia/Singapore" /><option value="Australia/Sydney" /><option value="UTC" /></datalist></label>
        </div>
      </section>

      <section className="rounded-3xl border border-black/10 bg-white/65 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.04)] sm:p-7 dark:border-white/10 dark:bg-white/4">
        <h2 className="text-lg font-semibold">Display preferences</h2>
        <p className="mt-1 text-sm text-black/45 dark:text-white/45">These defaults apply per page type across all environments and channels.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <DisplayModeField name="environmentsView" label="Environments" description="Dashboard environment overview." defaultValue={initialPreferences.environments} />
          <DisplayModeField name="channelsView" label="Channels" description="Channel lists inside every environment." defaultValue={initialPreferences.channels} />
          <DisplayModeField name="snapshotsView" label="Snapshots" description="Catalog templates and shared snapshots." defaultValue={initialPreferences.snapshots} />
          <DisplayModeField name="settingsView" label="Settings" description="Saved BigCommerce environment connections." defaultValue={initialPreferences.settings} />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-2xl border border-black/10 p-4 dark:border-white/10"><input type="checkbox" name="showSharedSnapshots" defaultChecked={initialPreferences.showSharedSnapshots} className="mt-0.5 size-4 accent-emerald-600" /><span><span className="block text-sm font-semibold">Show shared snapshots</span><span className="mt-1 block text-xs leading-5 text-black/45 dark:text-white/45">Include published snapshots from other users in the Snapshots page.</span></span></label>
          <label className="flex items-start gap-3 rounded-2xl border border-black/10 p-4 dark:border-white/10"><input type="checkbox" name="sidebarCollapsed" defaultChecked={initialPreferences.sidebarCollapsed} className="mt-0.5 size-4 accent-emerald-600" /><span><span className="block text-sm font-semibold">Collapse navigation menu</span><span className="mt-1 block text-xs leading-5 text-black/45 dark:text-white/45">Use the compact icon-only navigation application-wide.</span></span></label>
        </div>
      </section>

      <div className="flex items-center justify-between gap-4">
        <p role="status" className={`text-sm ${state.status === "error" ? "text-red-600 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>{state.message}</p>
        <button type="submit" disabled={pending} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-50">{pending ? "Saving…" : "Save profile"}</button>
      </div>
    </form>
  );
}
