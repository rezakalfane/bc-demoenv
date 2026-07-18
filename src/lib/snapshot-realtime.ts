import "server-only";

import { Rest } from "ably";
import {
  SNAPSHOT_REALTIME_CHANNEL,
  type SnapshotRealtimeEvent,
} from "@/lib/snapshot-realtime-events";

let client: Rest | undefined;

function getClient() {
  const key = process.env.ABLY_API_KEY;
  if (!key) return null;
  client ??= new Rest({ key });
  return client;
}

export function isSnapshotRealtimeConfigured() {
  return Boolean(process.env.ABLY_API_KEY);
}

export async function publishSnapshotRealtimeEvent(
  event: SnapshotRealtimeEvent,
) {
  const ably = getClient();
  if (!ably) return;

  try {
    await ably.channels.get(SNAPSHOT_REALTIME_CHANNEL).publish(event.type, event);
  } catch (error) {
    console.error("Unable to publish snapshot realtime event", error);
  }
}
