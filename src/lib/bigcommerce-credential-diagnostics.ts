import "server-only";

import {
  getBigCommerceEnvironmentConnection,
  type BigCommerceEnvironmentConnection,
} from "@/lib/db";

const API_BASE_URL = "https://api.bigcommerce.com/stores";
const B2B_API_BASE_URL = "https://api-b2b.bigcommerce.com/api/v3/io";
const REQUEST_TIMEOUT_MS = 10_000;
const PROBE_BATCH_SIZE = 4;

export type CredentialProbeStatus =
  | "available"
  | "missing_scope"
  | "unavailable"
  | "invalid_credentials"
  | "rate_limited"
  | "error";

export type CredentialOperationStatus =
  | "available"
  | "limited"
  | "unavailable"
  | "not_verified";

export type CredentialProbeResult = {
  id: string;
  label: string;
  scope: string;
  status: CredentialProbeStatus;
  detail: string;
};

export type CredentialOperationResult = {
  label: string;
  status: CredentialOperationStatus;
  detail: string;
};

export type CredentialB2BChannel = {
  id: number;
  name: string;
  status: "enabled" | "not_enabled" | "unavailable";
  detail: string;
};

export type CredentialDiagnosticsReport = {
  environmentId: number;
  environmentName: string;
  storeHash: string;
  testedAt: string;
  status: "connected" | "partial" | "unavailable";
  summary: string;
  operations: CredentialOperationResult[];
  missingScopes: Array<{ scope: string; detail: string }>;
  b2b: {
    status: "enabled" | "available" | "missing_scope" | "unavailable";
    summary: string;
    channels: CredentialB2BChannel[];
  };
  unavailableApis: Array<{ label: string; detail: string }>;
  probes: CredentialProbeResult[];
};

type ConnectedEnvironment = BigCommerceEnvironmentConnection & {
  accessToken: string;
};

type ChannelSummary = {
  id: number;
  name: string;
  platform: string;
  type: string;
};

type ProbeDefinition = {
  id: string;
  label: string;
  scope: string;
  path: string;
  unavailableDetail: string;
};

type ProbeResponse = {
  result: CredentialProbeResult;
  payload: unknown;
};

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readPositiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function parseResponsePayload(response: Response) {
  const text = response.status === 204 ? "" : await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function responseDetail(payload: unknown) {
  const record = asRecord(payload);
  const title = readString(record?.title);
  const detail = readString(record?.detail);
  const message = readString(record?.message);
  return detail || message || title;
}

function classifyProbe(
  definition: Pick<ProbeDefinition, "id" | "label" | "scope" | "unavailableDetail">,
  response: Response,
  payload: unknown,
): CredentialProbeResult {
  if (response.ok) {
    return {
      id: definition.id,
      label: definition.label,
      scope: definition.scope,
      status: "available",
      detail: "Read access verified.",
    };
  }
  if (response.status === 401) {
    return {
      id: definition.id,
      label: definition.label,
      scope: definition.scope,
      status: "invalid_credentials",
      detail: "BigCommerce rejected the saved access token.",
    };
  }
  if (response.status === 403) {
    return {
      id: definition.id,
      label: definition.label,
      scope: definition.scope,
      status: "missing_scope",
      detail: `Add ${definition.scope} read access to this API account.`,
    };
  }
  if (response.status === 404 || response.status === 405) {
    return {
      id: definition.id,
      label: definition.label,
      scope: definition.scope,
      status: "unavailable",
      detail: definition.unavailableDetail,
    };
  }
  if (response.status === 429) {
    return {
      id: definition.id,
      label: definition.label,
      scope: definition.scope,
      status: "rate_limited",
      detail: "BigCommerce rate limiting prevented this check. Test again shortly.",
    };
  }
  return {
    id: definition.id,
    label: definition.label,
    scope: definition.scope,
    status: "error",
    detail: responseDetail(payload) || `BigCommerce returned HTTP ${response.status}.`,
  };
}

async function runManagementProbe(
  environment: ConnectedEnvironment,
  definition: ProbeDefinition,
): Promise<ProbeResponse> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/${encodeURIComponent(environment.storeHash)}${definition.path}`,
      {
        headers: {
          Accept: "application/json",
          "X-Auth-Token": environment.accessToken,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const payload = await parseResponsePayload(response);
    return { result: classifyProbe(definition, response, payload), payload };
  } catch (error) {
    return {
      result: {
        id: definition.id,
        label: definition.label,
        scope: definition.scope,
        status: "error",
        detail: error instanceof Error && error.name === "TimeoutError"
          ? "BigCommerce took too long to respond."
          : "Unable to reach this BigCommerce API.",
      },
      payload: null,
    };
  }
}

async function mapInBatches<T, R>(items: T[], mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += PROBE_BATCH_SIZE) {
    results.push(...await Promise.all(items.slice(index, index + PROBE_BATCH_SIZE).map(mapper)));
  }
  return results;
}

function readChannels(payload: unknown): ChannelSummary[] {
  const data = asRecord(payload)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((value) => {
    const channel = asRecord(value);
    const id = readPositiveInteger(channel?.id);
    const name = readString(channel?.name);
    const status = readString(channel?.status).toLowerCase();
    if (!id || !name || status === "deleted") return [];
    return [{
      id,
      name,
      platform: readString(channel?.platform).toLowerCase(),
      type: readString(channel?.type).toLowerCase(),
    }];
  });
}

async function diagnoseB2BChannel(
  environment: ConnectedEnvironment,
  channel: ChannelSummary,
) {
  const definition = {
    id: `b2b-${channel.id}`,
    label: `B2B Edition · ${channel.name}`,
    scope: "B2B Edition",
    unavailableDetail: "B2B Edition is not installed or this channel is not registered with it.",
  };
  try {
    const response = await fetch(`${B2B_API_BASE_URL}/channels/${channel.id}`, {
      headers: {
        Accept: "application/json",
        "X-Auth-Token": environment.accessToken,
        "X-Store-Hash": environment.storeHash,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await parseResponsePayload(response);
    const probe = classifyProbe(definition, response, payload);
    const enabled = asRecord(asRecord(payload)?.data)?.b2bEnabled === true;
    return {
      probe,
      channel: {
        id: channel.id,
        name: channel.name,
        status: probe.status === "available"
          ? enabled ? "enabled" as const : "not_enabled" as const
          : "unavailable" as const,
        detail: probe.status === "available"
          ? enabled
            ? "B2B Edition is enabled for this channel."
            : "B2B Edition API access is available, but this channel is not B2B enabled."
          : probe.detail,
      },
    };
  } catch (error) {
    const detail = error instanceof Error && error.name === "TimeoutError"
      ? "BigCommerce B2B Edition took too long to respond."
      : "Unable to reach BigCommerce B2B Edition.";
    return {
      probe: {
        ...definition,
        status: "error" as const,
        detail,
      },
      channel: {
        id: channel.id,
        name: channel.name,
        status: "unavailable" as const,
        detail,
      },
    };
  }
}

function operation(
  label: string,
  status: CredentialOperationStatus,
  detail: string,
): CredentialOperationResult {
  return { label, status, detail };
}

export async function diagnoseBigCommerceCredential(
  userId: string,
  environmentId: number,
): Promise<CredentialDiagnosticsReport> {
  const environment = await getBigCommerceEnvironmentConnection(userId, environmentId);
  if (!environment) throw new Error("Environment not found.");
  if (!environment.accessToken) {
    throw new Error("The saved token could not be decrypted. Re-save it before testing access.");
  }
  const connected: ConnectedEnvironment = { ...environment, accessToken: environment.accessToken };

  const channelsProbe = await runManagementProbe(connected, {
    id: "channels",
    label: "Channels",
    scope: "Channel Settings",
    path: "/v3/channels?limit=250",
    unavailableDetail: "The Channels API is unavailable for this store.",
  });
  const channels = channelsProbe.result.status === "available"
    ? readChannels(channelsProbe.payload)
    : [];
  const primaryChannel = channels[0];

  const definitions: ProbeDefinition[] = [
    {
      id: "store-information",
      label: "Store information and settings",
      scope: "Information & Settings",
      path: "/v2/store",
      unavailableDetail: "Store information is unavailable for this store.",
    },
    {
      id: "catalog",
      label: "Products and catalog",
      scope: "Products",
      path: "/v3/catalog/products?limit=1&include_fields=id",
      unavailableDetail: "The Catalog API is unavailable for this store.",
    },
    {
      id: "sites",
      label: "Sites and routes",
      scope: "Sites & Routes",
      path: "/v3/sites?limit=1",
      unavailableDetail: "Sites and Routes are unavailable for this store plan or channel setup.",
    },
    {
      id: "storefront-settings",
      label: "Storefront settings",
      scope: "Information & Settings",
      path: "/v3/settings/store/profile",
      unavailableDetail: "Storefront settings are unavailable for this store.",
    },
    {
      id: "customers",
      label: "Customer settings and groups",
      scope: "Customers",
      path: "/v3/customers?limit=1",
      unavailableDetail: "The Customers API is unavailable for this store.",
    },
    {
      id: "shipping",
      label: "Shipping settings",
      scope: "Shipping",
      path: "/v2/shipping/zones",
      unavailableDetail: "Shipping zones are unavailable for this store.",
    },
    {
      id: "tax",
      label: "Tax settings",
      scope: "Tax",
      path: "/v3/tax/settings",
      unavailableDetail: "The Tax Settings API is unavailable for this store or tax-provider configuration.",
    },
    {
      id: "inventory",
      label: "Inventory locations",
      scope: "Products",
      path: "/v3/inventory/locations?limit=1",
      unavailableDetail: "Inventory Locations are not enabled or exposed for this store.",
    },
    ...(primaryChannel ? [
      {
        id: "content",
        label: "Channel content and scripts",
        scope: "Content",
        path: `/v3/content/scripts?channel_id=${primaryChannel.id}&limit=1`,
        unavailableDetail: "Channel scripts are unavailable for this channel type.",
      },
      {
        id: "pricing",
        label: "Channel pricing and currencies",
        scope: "Products",
        path: `/v3/channels/${primaryChannel.id}/currency-assignments`,
        unavailableDetail: "Currency assignments are unavailable for this channel type.",
      },
      ...(primaryChannel.platform === "bigcommerce" ? [{
        id: "themes",
        label: "Stencil themes",
        scope: "Themes",
        path: `/v3/channels/${primaryChannel.id}/active-theme`,
        unavailableDetail: "No active Stencil theme is available for this channel.",
      }] : []),
    ] : []),
  ];

  const probeResponses = await mapInBatches(definitions, (definition) =>
    runManagementProbe(connected, definition));
  const b2bResults = await mapInBatches(channels.slice(0, 50), (channel) =>
    diagnoseB2BChannel(connected, channel));
  const probes = [
    channelsProbe.result,
    ...probeResponses.map(({ result }) => result),
    ...b2bResults.map(({ probe }) => probe),
  ];
  const probeById = new Map(probes.map((probe) => [probe.id, probe]));
  const catalogReady = probeById.get("catalog")?.status === "available";
  const channelsReady = channelsProbe.result.status === "available";
  const requiredReadReady = catalogReady && channelsReady;
  const configurationProbes = probes.filter((probe) =>
    !["channels", "catalog"].includes(probe.id) && !probe.id.startsWith("b2b-"));
  const optionalAvailable = configurationProbes.filter((probe) => probe.status === "available").length;
  const optionalUnavailable = configurationProbes.length - optionalAvailable;
  const enabledB2BChannels = b2bResults.filter(({ channel }) => channel.status === "enabled");
  const b2bMissingScope = b2bResults.some(({ probe }) => probe.status === "missing_scope");
  const b2bApiAvailable = b2bResults.some(({ probe }) => probe.status === "available");

  const operations: CredentialOperationResult[] = [
    operation(
      "Dashboard and environment browsing",
      requiredReadReady ? "available" : "unavailable",
      requiredReadReady
        ? "Channel and catalog read access is verified."
        : "Requires Products and Channel Settings read access.",
    ),
    operation(
      "Browse channel catalogs",
      requiredReadReady ? "available" : "unavailable",
      requiredReadReady
        ? "Products, variants, category trees, and channel assignments can be read."
        : "Requires Products and Channel Settings read access.",
    ),
    operation(
      "Capture catalog snapshots",
      requiredReadReady ? "available" : "unavailable",
      requiredReadReady
        ? "Required catalog capture APIs are available."
        : "Catalog snapshots require Products and Channel Settings read access.",
    ),
    operation(
      "Capture optional configuration",
      optionalUnavailable === 0 ? "available" : optionalAvailable > 0 ? "limited" : "unavailable",
      optionalUnavailable === 0
        ? "All tested optional configuration APIs are available."
        : `${optionalAvailable} of ${configurationProbes.length} tested optional API groups are available; capture remains best-effort.`,
    ),
    operation(
      "Restore or clear catalog",
      requiredReadReady ? "not_verified" : "unavailable",
      requiredReadReady
        ? "Read access is verified. Products: modify is required; diagnostics do not send write requests."
        : "Products read access must work before restore or clear can be considered.",
    ),
    operation(
      "Restore optional configuration",
      optionalAvailable > 0 ? "not_verified" : "unavailable",
      optionalAvailable > 0
        ? "Matching modify scopes are required; diagnostics intentionally verify read access only."
        : "No optional configuration API was available to assess.",
    ),
    operation(
      "Capture B2B Edition data",
      enabledB2BChannels.length > 0 ? "available" : b2bApiAvailable ? "limited" : "unavailable",
      enabledB2BChannels.length > 0
        ? `${enabledB2BChannels.length} B2B-enabled channel${enabledB2BChannels.length === 1 ? "" : "s"} detected.`
        : b2bApiAvailable
          ? "B2B Edition is reachable, but no tested channel is B2B enabled."
          : "B2B Edition access is unavailable.",
    ),
    operation(
      "Restore B2B Edition data",
      enabledB2BChannels.length > 0 ? "not_verified" : "unavailable",
      enabledB2BChannels.length > 0
        ? "B2B read access is verified. B2B Edition: modify is required and is not tested."
        : "Requires a B2B-enabled destination channel and B2B Edition API access.",
    ),
  ];

  const missingScopes = [...new Map(
    probes
      .filter((probe) => probe.status === "missing_scope")
      .map((probe) => [probe.scope, { scope: probe.scope, detail: probe.detail }]),
  ).values()];
  const unavailableApis = [
    ...probes
      .filter((probe) =>
        probe.status === "unavailable" && !probe.id.startsWith("b2b-"))
      .map((probe) => ({ label: probe.label, detail: probe.detail })),
    ...channels
      .filter((channel) => channel.platform !== "bigcommerce")
      .map((channel) => ({
        label: `Stencil active theme · ${channel.name}`,
        detail: `Not applicable to ${channel.platform || channel.type || "this"} channels.`,
      })),
  ];
  const availableCount = probes.filter((probe) => probe.status === "available").length;
  const invalidCredentials = probes.some((probe) => probe.status === "invalid_credentials");
  const blockingProbeIssue = probes.some((probe) =>
    ["missing_scope", "error", "rate_limited"].includes(probe.status));
  const status = invalidCredentials || availableCount === 0
    ? "unavailable" as const
    : blockingProbeIssue
      ? "partial" as const
      : "connected" as const;
  const b2b = {
    status: enabledB2BChannels.length > 0
      ? "enabled" as const
      : b2bMissingScope
        ? "missing_scope" as const
        : b2bApiAvailable
          ? "available" as const
          : "unavailable" as const,
    summary: enabledB2BChannels.length > 0
      ? `${enabledB2BChannels.length} of ${channels.length} active channels are B2B enabled.`
      : b2bMissingScope
        ? "Add B2B Edition read access to determine channel availability."
        : b2bApiAvailable
          ? "The B2B API is reachable, but no active channel is B2B enabled."
          : channels.length === 0
            ? "B2B availability could not be tested because no active channel was returned."
            : "B2B Edition is not installed or exposed for this store.",
    channels: b2bResults.map(({ channel }) => channel),
  };

  return {
    environmentId: environment.id,
    environmentName: environment.name,
    storeHash: environment.storeHash,
    testedAt: new Date().toISOString(),
    status,
    summary: status === "connected"
      ? "All tested read capabilities are available."
      : status === "partial"
        ? `${availableCount} capabilities verified; review missing scopes and unavailable APIs below.`
        : invalidCredentials
          ? "BigCommerce rejected the saved token."
          : "No tested BigCommerce capability could be verified.",
    operations,
    missingScopes,
    b2b,
    unavailableApis,
    probes,
  };
}
