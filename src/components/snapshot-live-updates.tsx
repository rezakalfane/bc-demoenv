"use client";

import { Realtime } from "ably";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import {
  SNAPSHOT_REALTIME_CHANNEL,
  SNAPSHOT_REALTIME_EVENTS,
} from "@/lib/snapshot-realtime-events";

const REFRESH_DEBOUNCE_MS = 350;
const FALLBACK_REFRESH_MS = 30_000;

export function SnapshotLiveUpdates({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const refreshTimer = useRef<number | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      if (disposed) return;
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
      }
      refreshTimer.current = window.setTimeout(() => {
        startTransition(() => router.refresh());
      }, REFRESH_DEBOUNCE_MS);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const fallbackTimer = window.setInterval(refreshWhenVisible, FALLBACK_REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    let realtime: Realtime | null = null;
    let channel: ReturnType<Realtime["channels"]["get"]> | null = null;
    const listener = () => refresh();

    if (enabled) {
      realtime = new Realtime({
        authUrl: "/api/realtime/token",
        authMethod: "GET",
        echoMessages: false,
      });
      channel = realtime.channels.get(SNAPSHOT_REALTIME_CHANNEL);
      void channel.subscribe([...SNAPSHOT_REALTIME_EVENTS], listener).catch((error) => {
        if (!disposed) {
          console.warn("Unable to subscribe to snapshot realtime updates; using fallback refreshes.", error);
        }
      });
    }

    return () => {
      disposed = true;
      window.clearInterval(fallbackTimer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      channel?.unsubscribe([...SNAPSHOT_REALTIME_EVENTS], listener);
      try {
        realtime?.close();
      } catch (error) {
        console.warn("Unable to close the snapshot realtime connection cleanly.", error);
      }
    };
  }, [enabled, router]);

  return null;
}
