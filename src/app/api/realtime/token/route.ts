import { Rest } from "ably";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAllowedEmail } from "@/lib/email-domain";
import { SNAPSHOT_REALTIME_CHANNEL } from "@/lib/snapshot-realtime-events";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!email || !isAllowedEmail(email)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const key = process.env.ABLY_API_KEY;
  if (!key) {
    return Response.json(
      { error: "Realtime updates are not configured." },
      { status: 503 },
    );
  }

  const ably = new Rest({ key });
  const tokenRequest = await ably.auth.createTokenRequest({
    clientId: userId,
    capability: JSON.stringify({
      [SNAPSHOT_REALTIME_CHANNEL]: ["subscribe"],
    }),
    ttl: 60 * 60 * 1000,
  });

  return Response.json(tokenRequest);
}
