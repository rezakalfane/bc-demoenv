import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { AppI18nProvider } from "@/components/app-i18n-provider";
import { OfflineSupport } from "@/components/offline-support";
import { APP_LOCALE_COOKIE, normalizeAppLocale } from "@/i18n/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BigCommerce Demo Environments Manager",
  description:
    "Live BigCommerce environment dashboards, private notes, and tenant-scoped settings.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const locale = normalizeAppLocale(cookieStore.get(APP_LOCALE_COOKIE)?.value);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-in"
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
        >
          <AppI18nProvider initialLocale={locale}>{children}</AppI18nProvider>
        </ClerkProvider>
        <OfflineSupport />
      </body>
    </html>
  );
}
