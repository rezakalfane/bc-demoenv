"use client";

import { useEffect } from "react";

export function OfflineSupport() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let disposed = false;
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/offline-sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (!disposed) void registration.update().catch(() => undefined);
      } catch {
        // Registration is best-effort and will be retried on the next online load.
      }
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      disposed = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
