import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PasswordlessAuthForm } from "@/components/passwordless-auth-form";
import { isAllowedEmail } from "@/lib/email-domain";

export default async function SignInPage() {
  const { userId } = await auth();

  if (userId) {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress;

    redirect(email && isAllowedEmail(email) ? "/" : "/access-denied");
  }

  return (
    <main className="flex min-h-screen items-center px-5 py-12 sm:px-8">
      <div className="mx-auto grid w-full max-w-4xl items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="mb-5 flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
            BigCommerce tools
          </div>
          <h1 className="max-w-lg text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
            BigCommerce Demo Environments Manager
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-black/55 dark:text-white/55">
            Manage demo stores and channels, capture reusable catalog snapshots,
            and safely restore or refresh environments from one place.
          </p>
        </div>
        <PasswordlessAuthForm />
      </div>
    </main>
  );
}
