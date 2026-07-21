"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { dispatchLocalDueSchedules } from "@/app/(app)/scheduler/actions";

const LOCAL_SCHEDULER_INTERVAL_MS = 60_000;

export function LocalSchedulerDispatcher({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const runningRef = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !enabled) return;

    let disposed = false;
    const dispatch = async () => {
      if (disposed || runningRef.current) return;
      runningRef.current = true;
      try {
        const result = await dispatchLocalDueSchedules();
        if (!disposed && result.dispatched > 0) router.refresh();
      } catch (error) {
        console.error("Unable to dispatch local catalog schedules", error);
      } finally {
        runningRef.current = false;
      }
    };

    void dispatch();
    const timer = window.setInterval(() => void dispatch(), LOCAL_SCHEDULER_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [enabled, router]);

  return null;
}
