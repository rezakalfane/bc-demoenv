import { SignOutButton } from "@/components/sign-out-button";

export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-lg rounded-3xl border border-black/10 bg-white/70 p-8 text-center shadow-[0_18px_60px_rgba(0,0,0,0.07)] backdrop-blur dark:border-white/10 dark:bg-white/5">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          Access restricted
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Use an approved work email
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-black/55 dark:text-white/55">
          BigCommerce Demo Environments Manager is limited to verified
          @bigcommerce.com and @commerce.com accounts. Sign out and try again
          with an approved address.
        </p>
        <div className="mt-6 flex justify-center">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
