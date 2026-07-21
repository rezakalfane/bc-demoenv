"use client";

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  saveProfileAndPreferences,
  type ProfileActionState,
} from "@/app/(app)/settings/profile/actions";
import { useCollectionPreference } from "@/components/collection-preferences-provider";
import { ProfileAvatar } from "@/components/profile-avatar";
import type { CollectionViewMode, UserProfile } from "@/lib/db";
import { PROFILE_AVATAR_UPLOAD_MAX_LENGTH } from "@/lib/profile-avatar";

const initialState: ProfileActionState = { status: "idle", message: "" };

function profileInitials(firstName: string, lastName: string, email: string) {
  const initials = [firstName, lastName]
    .map((value) => value.trim().charAt(0))
    .filter(Boolean)
    .join("")
    .toUpperCase();

  return initials || email.trim().charAt(0).toUpperCase() || "U";
}

async function resizeAndCropAvatar(file: File) {
  if (!file.type.match(/^image\/(?:png|jpeg|webp)$/)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Choose an image smaller than 8 MB.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The selected image could not be read."));
    });

    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    if (!sourceSize) throw new Error("The selected image has no usable dimensions.");

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare the avatar image.");

    context.drawImage(
      image,
      (image.naturalWidth - sourceSize) / 2,
      (image.naturalHeight - sourceSize) / 2,
      sourceSize,
      sourceSize,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const result = canvas.toDataURL("image/webp", 0.84);
    if (result.length > PROFILE_AVATAR_UPLOAD_MAX_LENGTH) {
      throw new Error("The resized image is still too large. Try a simpler photo.");
    }
    return result;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

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
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [avatarError, setAvatarError] = useState("");
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const initials = profileInitials(firstName, lastName, email);

  async function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setAvatarError("");
    setProcessingAvatar(true);
    try {
      setAvatar(await resizeAndCropAvatar(file));
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "The photo could not be processed.");
    } finally {
      setProcessingAvatar(false);
    }
  }

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
        <fieldset className="mt-6 rounded-2xl border border-black/10 p-4 sm:p-5 dark:border-white/10">
          <legend className="px-1 text-sm font-semibold">Avatar</legend>
          <input type="hidden" name="avatar" value={avatar} />
          <div className="flex items-center gap-4">
            <ProfileAvatar value={avatar} initials={initials} className="size-20 text-2xl" />
            <div>
              <p className="text-sm font-semibold">Profile picture</p>
              <p className="mt-1 max-w-md text-xs leading-5 text-black/45 dark:text-white/45">
                Photos are center-cropped and resized to 256 × 256 in your browser.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={processingAvatar}
                  onClick={() => avatarInputRef.current?.click()}
                  className="rounded-lg border border-emerald-600/35 bg-emerald-500/8 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/15 disabled:cursor-wait disabled:opacity-50 dark:text-emerald-300"
                >
                  {processingAvatar ? "Preparing…" : "Upload photo"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAvatar("initials");
                    setAvatarError("");
                  }}
                  className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                >
                  Use initials
                </button>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarUpload}
                className="sr-only"
                tabIndex={-1}
              />
            </div>
          </div>
          {avatarError ? <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">{avatarError}</p> : null}
        </fieldset>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label><span className="text-sm font-medium">First name</span><input name="firstName" value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={80} autoComplete="given-name" className="mt-2 w-full rounded-xl border border-black/10 bg-background px-3 py-2.5 dark:border-white/10" /></label>
          <label><span className="text-sm font-medium">Last name</span><input name="lastName" value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={80} autoComplete="family-name" className="mt-2 w-full rounded-xl border border-black/10 bg-background px-3 py-2.5 dark:border-white/10" /></label>
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
        <button type="submit" disabled={pending || processingAvatar} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-50">{pending ? "Saving…" : "Save profile"}</button>
      </div>
    </form>
  );
}
