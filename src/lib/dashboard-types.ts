export const environmentMetricKeys = [
  "channels",
  "categories",
  "products",
  "variants",
] as const;

export type MetricKey = (typeof environmentMetricKeys)[number];

export type EnvironmentMetric = {
  label: string;
  value: number | null;
  error: string | null;
};

export type EnvironmentDashboard = {
  id: number;
  name: string;
  storeHash: string;
  status: "connected" | "partial" | "unavailable" | "loading";
  isFavorite: boolean;
  refreshedAt: string | null;
  metrics: Record<MetricKey, EnvironmentMetric>;
};
