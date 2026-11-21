import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "./providerInstance.ts";
import * as Schema from "effect/Schema";

/**
 * Built-in connection presets for local, OpenAI-compatible model gateways.
 *
 * Every preset is loopback-only and bills nothing: the generated model
 * entries carry zero cost and the connection flow refuses non-local URLs.
 * Credentials stay in the mechanism each gateway already uses (for OmniRoute,
 * `~/.mt/omniroute/mt-key.json`); no key is stored in a preset or plan.
 */

export const OMNIROUTE_GATEWAY_ORIGIN = "http://127.0.0.1:20128";
export const OMNIROUTE_GATEWAY_BASE_URL = `${OMNIROUTE_GATEWAY_ORIGIN}/v1`;
export const LOCAL_OPENAI_COMPATIBLE_BASE_URL = "http://127.0.0.1:1234/v1";

export type GatewayPresetId = "omniroute" | "local-openai-compatible";
export const GatewayConnectInput = Schema.Struct({
  presetId: Schema.Literals(["omniroute", "local-openai-compatible"]),
  baseUrl: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2048))),
  models: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(8192))),
});
export type GatewayConnectInput = typeof GatewayConnectInput.Type;

export interface GatewayPreset {
  readonly id: GatewayPresetId;
  readonly label: string;
  readonly description: string;
  /** Existing provider instance the flow connects or reconnects. */
  readonly providerInstanceId: string;
  readonly displayName: string;
  /** `acp-agent` runs the local assistant agent; `opencode` writes a config file. */
  readonly transport: "acp-agent" | "opencode";
  readonly baseUrl: string;
  readonly dashboardUrl?: string;
  /** Provider id inside the generated OpenAI-compatible config. */
  readonly configProviderId: string;
  readonly noBilling: true;
}

export const GATEWAY_PRESETS = [
  {
    id: "omniroute",
    label: "OmniRoute",
    description:
      "Local OmniRoute gateway with its free chat routes. Reuses the gateway key the OmniRoute setup already stores.",
    providerInstanceId: "omniroute-free",
    displayName: "OmniRoute · free models",
    transport: "acp-agent",
    baseUrl: OMNIROUTE_GATEWAY_BASE_URL,
    dashboardUrl: `${OMNIROUTE_GATEWAY_ORIGIN}/dashboard/providers`,
    configProviderId: "omniroute",
    noBilling: true,
  },
  {
    id: "local-openai-compatible",
    label: "Local OpenAI-compatible",
    description:
      "LM Studio, Ollama, vLLM or another gateway on this computer that speaks the OpenAI chat API. Models are recorded as zero-cost.",
    providerInstanceId: "local-openai",
    displayName: "Local · OpenAI-compatible",
    transport: "opencode",
    baseUrl: LOCAL_OPENAI_COMPATIBLE_BASE_URL,
    configProviderId: "local-openai",
    noBilling: true,
  },
] as const satisfies readonly GatewayPreset[];

const PRESETS_BY_ID = new Map<GatewayPresetId, GatewayPreset>(
  GATEWAY_PRESETS.map((preset) => [preset.id, preset]),
);

export function gatewayPreset(id: GatewayPresetId): GatewayPreset {
  const preset = PRESETS_BY_ID.get(id);
  if (!preset) throw new Error(`Unknown gateway preset '${id}'.`);
  return preset;
}

export function isGatewayPresetId(value: string): value is GatewayPresetId {
  return PRESETS_BY_ID.has(value as GatewayPresetId);
}

export interface GatewayEndpoint {
  /** Base URL without a trailing slash, e.g. `http://127.0.0.1:20128/v1`. */
  readonly baseUrl: string;
  readonly origin: string;
}

export type GatewayEndpointResult =
  | { readonly ok: true; readonly endpoint: GatewayEndpoint }
  | { readonly ok: false; readonly error: string };

/** Gateways on this machine only: no LAN address, tunnel or remote host. */
export function isLoopbackGatewayHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, "");
}

function normalizePathname(pathname: string): string {
  const withoutSlashes = trimTrailingSlashes(pathname);
  return withoutSlashes === "" ? "" : withoutSlashes;
}

function endpointFromUrl(url: URL): GatewayEndpoint {
  const path = normalizePathname(url.pathname);
  return {
    baseUrl: `${url.origin}${path}`,
    origin: url.origin,
  };
}

/** Accepts only an absolute http(s) loopback URL without credentials or query. */
export function normalizeGatewayBaseUrl(input: string): GatewayEndpointResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "Enter the gateway URL." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "Enter a full http:// or https:// URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "The gateway URL must use http:// or https://." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Do not put credentials in the gateway URL." };
  }
  if (url.search || url.hash) {
    return { ok: false, error: "The gateway URL cannot include a query or fragment." };
  }
  if (!isLoopbackGatewayHost(url.hostname)) {
    return {
      ok: false,
      error: "This preset connects only to a gateway on this computer (localhost).",
    };
  }
  return { ok: true, endpoint: endpointFromUrl(url) };
}

/**
 * Resolves the preset endpoint, pinning OmniRoute to its local origin and
 * filling in the usual `/v1` suffix when the user pasted only an origin.
 */
export function resolveGatewayPresetEndpoint(
  presetId: GatewayPresetId,
  input?: string,
): GatewayEndpointResult {
  const preset = gatewayPreset(presetId);
  const normalized = normalizeGatewayBaseUrl(input?.trim() || preset.baseUrl);
  if (!normalized.ok) return normalized;
  if (preset.id === "omniroute") {
    if (normalized.endpoint.origin !== OMNIROUTE_GATEWAY_ORIGIN) {
      return {
        ok: false,
        error: `OmniRoute runs at ${OMNIROUTE_GATEWAY_ORIGIN}. Start it there or choose the local OpenAI-compatible preset.`,
      };
    }
    return {
      ok: true,
      endpoint: { ...normalized.endpoint, baseUrl: OMNIROUTE_GATEWAY_BASE_URL },
    };
  }
  const path = normalized.endpoint.baseUrl.slice(normalized.endpoint.origin.length);
  if (path === "") {
    return {
      ok: true,
      endpoint: { ...normalized.endpoint, baseUrl: `${normalized.endpoint.origin}/v1` },
    };
  }
  return normalized;
}

/** Splits comma- or newline-separated model ids, dropping blanks and duplicates. */
export function gatewayModelIds(input: string | readonly string[]): readonly string[] {
  const tokens = typeof input === "string" ? input.split(/[\n,]+/u) : input;
  const seen = new Set<string>();
  const models: string[] = [];
  for (const token of tokens) {
    const id = token.trim();
    if (!id || /\s/u.test(id) || seen.has(id)) continue;
    seen.add(id);
    models.push(id);
  }
  return models;
}

export interface CompatibleGatewayConfig {
  readonly $schema: string;
  readonly provider: Readonly<
    Record<
      string,
      {
        readonly npm: string;
        readonly name: string;
        readonly options: { readonly baseURL: string; readonly apiKey: string };
        readonly models: Readonly<
          Record<
            string,
            { readonly name: string; readonly cost: { readonly input: 0; readonly output: 0 } }
          >
        >;
      }
    >
  >;
}

/**
 * Config for OpenCode's OpenAI-compatible provider. `apiKey` defaults to the
 * literal `local`, which loopback servers ignore; never pass a real key here.
 */
export function buildCompatibleGatewayConfig(input: {
  readonly presetId: GatewayPresetId;
  readonly baseUrl: string;
  readonly models: readonly string[];
  readonly apiKey?: string;
}): CompatibleGatewayConfig {
  const preset = gatewayPreset(input.presetId);
  return {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [preset.configProviderId]: {
        npm: "@ai-sdk/openai-compatible",
        name: preset.label,
        options: {
          baseURL: input.baseUrl,
          apiKey: input.apiKey?.trim() || "local",
        },
        models: Object.fromEntries(
          gatewayModelIds(input.models).map((id) => [
            id,
            { name: id, cost: { input: 0, output: 0 } },
          ]),
        ),
      },
    },
  };
}

function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/u.test(value) || value.startsWith("/") || value.startsWith("\\\\");
}

export interface GatewayConnectionInput {
  readonly presetId: GatewayPresetId;
  /** Defaults to the preset endpoint. */
  readonly baseUrl?: string;
  readonly models?: string | readonly string[];
  readonly displayName?: string;
  /** Absolute path the environment uses for `OPENCODE_CONFIG`. */
  readonly configPath?: string;
  /** OmniRoute only: the local assistant agent to launch. */
  readonly agent?: {
    readonly commandPath: string;
    readonly commandArgs?: readonly string[];
  };
}

export interface GatewayConnectionPlan {
  readonly presetId: GatewayPresetId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly displayName: string;
  readonly endpoint: GatewayEndpoint;
  readonly models: readonly string[];
  readonly noBilling: true;
  readonly providerInstance: ProviderInstanceConfig;
  /** Generated config to write at `configPath`, or null for OmniRoute. */
  readonly configFile: { readonly contents: string } | null;
}

export type GatewayConnectionResult =
  | { readonly ok: true; readonly plan: GatewayConnectionPlan }
  | { readonly ok: false; readonly error: string };

/**
 * Builds everything the server needs to connect a preset: the provider
 * instance to upsert and, for the local preset, the config file contents.
 * The caller writes `configFile` to `configPath` before upserting.
 */
export function buildGatewayConnectionPlan(input: GatewayConnectionInput): GatewayConnectionResult {
  const preset = gatewayPreset(input.presetId);
  const endpoint = resolveGatewayPresetEndpoint(preset.id, input.baseUrl);
  if (!endpoint.ok) return endpoint;
  const configPath = input.configPath?.trim() ?? "";
  if (!isAbsolutePath(configPath)) {
    return { ok: false, error: "Choose an absolute config file path for this gateway." };
  }
  const models = gatewayModelIds(input.models ?? []);
  const displayName = input.displayName?.trim() || preset.displayName;
  const instanceId = ProviderInstanceId.make(preset.providerInstanceId);

  if (preset.transport === "opencode") {
    const config = buildCompatibleGatewayConfig({
      presetId: preset.id,
      baseUrl: endpoint.endpoint.baseUrl,
      models,
    });
    return {
      ok: true,
      plan: {
        presetId: preset.id,
        providerInstanceId: instanceId,
        displayName,
        endpoint: endpoint.endpoint,
        models,
        noBilling: true,
        providerInstance: {
          driver: ProviderDriverKind.make("opencode"),
          enabled: true,
          accountTier: "local",
          routingRole: "assistant",
          displayName,
          environment: [{ name: "OPENCODE_CONFIG", value: configPath, sensitive: false }],
          config: {
            configuredCatalogOnly: true,
            customModels: models.map((id) => `${preset.configProviderId}/${id}`),
          },
        },
        configFile: { contents: JSON.stringify(config, null, 2) },
      },
    };
  }

  const commandPath = input.agent?.commandPath.trim() ?? "";
  if (!isAbsolutePath(commandPath)) {
    return { ok: false, error: "Choose the local OmniRoute agent executable." };
  }
  return {
    ok: true,
    plan: {
      presetId: preset.id,
      providerInstanceId: instanceId,
      displayName,
      endpoint: endpoint.endpoint,
      models,
      noBilling: true,
      providerInstance: {
        driver: ProviderDriverKind.make("acpRegistry"),
        enabled: true,
        accountTier: "local",
        routingRole: "assistant",
        displayName,
        environment: [
          { name: "OPENCODE_CONFIG", value: configPath, sensitive: false },
          { name: "MT_CHAT_PROVIDER", value: "omniroute", sensitive: false },
        ],
        config: {
          source: "local",
          commandPath,
          commandArgs: [...(input.agent?.commandArgs ?? [])],
          customModels: models.map((id) => `${preset.configProviderId}/${id}`),
        },
      },
      // The OmniRoute catalog sync owns this file; never overwrite the gateway setup.
      configFile: null,
    },
  };
}
