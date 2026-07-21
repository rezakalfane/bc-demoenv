import "server-only";

import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isAllowedEmail, normalizeEmail } from "@/lib/email-domain";

export const requireAppUser = cache(async () => {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const user = await currentUser();
  const emailAddress = user?.primaryEmailAddress?.emailAddress;

  if (!emailAddress || !isAllowedEmail(emailAddress)) {
    redirect("/access-denied");
  }

  return {
    id: userId,
    email: normalizeEmail(emailAddress),
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
  };
});
