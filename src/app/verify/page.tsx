"use client";

import { Suspense } from "react";
import { useSignIn } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";

type VerificationStatus =
  | "loading"
  | "verified"
  | "expired"
  | "failed"
  | "client_mismatch";

const verificationContent: Record<
  VerificationStatus,
  { title: string; body: string }
> = {
  loading: {
    title: "Verifying your link…",
    body: "This should only take a moment.",
  },
  verified: {
    title: "You’re verified",
    body: "You can close this window. The original page will sign you in automatically.",
  },
  expired: {
    title: "This link has expired",
    body: "Return to the original page and request a new login link.",
  },
  failed: {
    title: "We couldn’t verify this link",
    body: "Return to the original page and try signing in again.",
  },
  client_mismatch: {
    title: "This link no longer matches your sign-in",
    body: "This can happen even in the same browser if an email security scanner opened the link, the original page reloaded, or a newer link was requested. Return to the original page and use an email code, or request one new link without refreshing that page.",
  },
};

function isVerificationStatus(value: string | null): value is VerificationStatus {
  return (
    value === "verified" ||
    value === "expired" ||
    value === "failed" ||
    value === "client_mismatch"
  );
}

function VerificationCard({ status }: { status: VerificationStatus }) {
  const content = verificationContent[status];

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md rounded-3xl border border-black/10 bg-white/70 p-8 text-center shadow-[0_18px_60px_rgba(0,0,0,0.07)] backdrop-blur dark:border-white/10 dark:bg-white/5">
        <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-emerald-500/12 text-xl text-emerald-700 dark:text-emerald-300">
          {status === "verified" ? "✓" : status === "loading" ? "·" : "!"}
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          {content.title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-black/55 dark:text-white/55">
          {content.body}
        </p>
      </div>
    </main>
  );
}

function VerificationResult() {
  const { signIn } = useSignIn();
  const searchParams = useSearchParams();
  const queryStatus = searchParams.get("__clerk_status");
  const clerkStatus = signIn.emailLink.verification?.status;
  const status: VerificationStatus = clerkStatus
    ? clerkStatus
    : isVerificationStatus(queryStatus)
      ? queryStatus
      : "loading";

  return <VerificationCard status={status} />;
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<VerificationCard status="loading" />}>
      <VerificationResult />
    </Suspense>
  );
}
