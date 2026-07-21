"use client";

import { SignOutButton as ClerkSignOutButton } from "@clerk/nextjs";

export function SignOutButton() {
  return (
    <ClerkSignOutButton redirectUrl="/sign-in">
      <button
        type="button"
        aria-label="Sign out"
        title="Sign out"
        className="sign-out-button inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-black/50 shadow-sm backdrop-blur transition hover:border-black/20 hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-white/10 dark:bg-white/5 dark:text-white/50 dark:hover:border-white/20 dark:hover:text-white"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="sign-out-icon size-4"
        >
          <path d="M10 17l5-5-5-5" />
          <path d="M15 12H3" />
          <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
        </svg>
        <span className="sign-out-label">Sign out</span>
      </button>
    </ClerkSignOutButton>
  );
}
