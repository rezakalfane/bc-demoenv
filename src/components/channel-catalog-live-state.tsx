"use client";

import { useEffect } from "react";
import { readCatalogOperation } from "@/components/catalog-operation-progress";

export function ChannelCatalogLiveState({ environmentId, channelId }: { environmentId: number; channelId: number }) {
  useEffect(() => {
    const className = `catalog-clearing-${environmentId}-${channelId}`;
    const sync = () => {
      const operation = readCatalogOperation();
      const active = (operation?.kind === "clear" || operation?.kind === "refresh") && operation.environmentId === environmentId && operation.channelId === channelId;
      document.body.classList.toggle(className, Boolean(active));
    };
    sync();
    window.addEventListener("catalog-operation-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      document.body.classList.remove(className);
      window.removeEventListener("catalog-operation-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, [channelId, environmentId]);
  return null;
}
