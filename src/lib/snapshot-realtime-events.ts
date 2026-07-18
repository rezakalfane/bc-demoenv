export const SNAPSHOT_REALTIME_CHANNEL = "catalog:snapshots:published:v1";

export const SNAPSHOT_REALTIME_EVENTS = [
  "snapshot.published",
  "snapshot.unpublished",
] as const;

export type SnapshotRealtimeEventName = (typeof SNAPSHOT_REALTIME_EVENTS)[number];

export type SnapshotRealtimeEvent = {
  type: SnapshotRealtimeEventName;
  snapshotId: number;
  snapshotName: string;
  snapshotVersion: number;
  occurredAt: string;
};
