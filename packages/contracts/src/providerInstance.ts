import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { SecretReference } from "./secretReference.ts";

const PROVIDER_SLUG_MAX_CHARS = 64;
const PROVIDER_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const ENVIRONMENT_VARIABLE_NAME_MAX_CHARS = 128;
const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const slugSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROVIDER_SLUG_MAX_CHARS),
  Schema.isPattern(PROVIDER_SLUG_PATTERN),
);

export const ProviderDriverKind = slugSchema.pipe(Schema.brand("ProviderDriverKind"));
export type ProviderDriverKind = typeof ProviderDriverKind.Type;

export const isProviderDriverKind = Schema.is(ProviderDriverKind);

export const ProviderInstanceId = slugSchema.pipe(Schema.brand("ProviderInstanceId"));
export type ProviderInstanceId = typeof ProviderInstanceId.Type;

export const ProviderInstanceEnvironmentVariableName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(ENVIRONMENT_VARIABLE_NAME_MAX_CHARS),
  Schema.isPattern(ENVIRONMENT_VARIABLE_NAME_PATTERN),
);
export type ProviderInstanceEnvironmentVariableName =
  typeof ProviderInstanceEnvironmentVariableName.Type;

const ProviderInstanceEnvironmentVariableValue = Schema.Struct({
  name: ProviderInstanceEnvironmentVariableName,
  value: Schema.Union([Schema.String, SecretReference]),
  sensitive: Schema.Boolean,
  valueRedacted: Schema.optionalKey(Schema.Boolean),
});

// A reference is encoded beside an empty value so older servers and clients still decode it.
const StoredProviderInstanceEnvironmentVariable = Schema.Struct({
  name: ProviderInstanceEnvironmentVariableName,
  value: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  sensitive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  valueRedacted: Schema.optionalKey(Schema.Boolean),
  secret: Schema.optionalKey(SecretReference),
});

export const ProviderInstanceEnvironmentVariable = StoredProviderInstanceEnvironmentVariable.pipe(
  Schema.decodeTo(
    Schema.toType(ProviderInstanceEnvironmentVariableValue),
    SchemaTransformation.transform<
      typeof ProviderInstanceEnvironmentVariableValue.Type,
      typeof StoredProviderInstanceEnvironmentVariable.Type
    >({
      decode: ({ secret, ...variable }) =>
        secret === undefined ? variable : { ...variable, value: secret, sensitive: true },
      encode: ({ value, ...variable }) =>
        typeof value === "string"
          ? { ...variable, value }
          : { ...variable, value: "", secret: value },
    }),
  ),
);
export type ProviderInstanceEnvironmentVariable = typeof ProviderInstanceEnvironmentVariable.Type;

export const ProviderInstanceEnvironment = Schema.Array(ProviderInstanceEnvironmentVariable);
export type ProviderInstanceEnvironment = typeof ProviderInstanceEnvironment.Type;

/** What drivers receive: every secret reference has been read into a plain value. */
export type ResolvedProviderInstanceEnvironment = ReadonlyArray<
  Omit<ProviderInstanceEnvironmentVariable, "value"> & { readonly value: string }
>;

/** Drivers decode their own config; unknown-driver envelopes round-trip verbatim across versions. */
export const ProviderInstanceConfig = Schema.Struct({
  driver: ProviderDriverKind,
  providerGroup: Schema.optionalKey(TrimmedNonEmptyString),
  settingsProfileId: Schema.optionalKey(ProviderInstanceId),
  accountTier: Schema.optionalKey(
    Schema.Literals(["free", "subscription", "paid-api", "local", "unknown"]),
  ),
  freeAccountPaused: Schema.optionalKey(Schema.Boolean),
  usagePolicy: Schema.optionalKey(
    Schema.Struct({
      sessionMaxUsedPercent: Schema.optionalKey(
        Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
      ),
      weeklyMaxUsedPercent: Schema.optionalKey(
        Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
      ),
    }),
  ),
  routingRole: Schema.optionalKey(Schema.Literals(["agent", "assistant", "excluded"])),
  displayName: Schema.optional(TrimmedNonEmptyString),
  accentColor: Schema.optional(TrimmedNonEmptyString),
  environment: Schema.optionalKey(ProviderInstanceEnvironment),
  enabled: Schema.optionalKey(Schema.Boolean),
  hidden: Schema.optionalKey(Schema.Boolean),
  config: Schema.optionalKey(Schema.Unknown),
});
export type ProviderInstanceConfig = typeof ProviderInstanceConfig.Type;

export const ProviderInstanceMutation = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("create"),
    instanceId: ProviderInstanceId,
    instance: ProviderInstanceConfig,
  }),
  Schema.Struct({
    operation: Schema.Literal("upsert"),
    instanceId: ProviderInstanceId,
    instance: ProviderInstanceConfig,
  }),
  Schema.Struct({
    operation: Schema.Literal("remove"),
    instanceId: ProviderInstanceId,
  }),
]);
export type ProviderInstanceMutation = typeof ProviderInstanceMutation.Type;

export const ProviderInstanceConfigMap = Schema.Record(ProviderInstanceId, ProviderInstanceConfig);
export type ProviderInstanceConfigMap = typeof ProviderInstanceConfigMap.Type;

/** The driver identifies the runtime. ACP registry entries also identify the actual agent. */
export function providerGroupId(
  instance: Pick<ProviderInstanceConfig, "driver" | "config" | "providerGroup">,
): string {
  if (instance.providerGroup) return `${instance.driver}:${instance.providerGroup}`;
  if (instance.driver !== "acpRegistry") return instance.driver;
  if (typeof instance.config !== "object" || instance.config === null) return instance.driver;
  const config = instance.config as Record<string, unknown>;
  const agent = config["agentId"];
  if (typeof agent === "string" && agent.trim()) return `acpRegistry:${agent.trim()}`;
  const command = config["commandPath"];
  const args = config["commandArgs"];
  if (typeof command === "string" && command.trim()) {
    return `acpRegistry:${JSON.stringify([command, args ?? []])}`;
  }
  return instance.driver;
}

export const ProviderRuntimePreferences = Schema.Record(
  TrimmedNonEmptyString,
  Schema.Struct({ binaryPath: TrimmedNonEmptyString }),
);
export type ProviderRuntimePreferences = typeof ProviderRuntimePreferences.Type;

/** Resolve common runtime options while keeping each account's credentials and home private. */
export function resolveProviderInstanceProfiles(
  instances: ProviderInstanceConfigMap,
): ProviderInstanceConfigMap {
  const resolved = new Map<string, ProviderInstanceConfig>();
  const visiting = new Set<string>();
  const resolve = (id: string): ProviderInstanceConfig => {
    const own = instances[ProviderInstanceId.make(id)]!;
    const existing = resolved.get(id);
    if (existing) return existing;
    const parent =
      own.settingsProfileId && Object.hasOwn(instances, own.settingsProfileId)
        ? instances[own.settingsProfileId]
        : undefined;
    if (!parent || parent.driver !== own.driver || visiting.has(id)) return own;
    visiting.add(id);
    const base = resolve(own.settingsProfileId!);
    visiting.delete(id);
    const config =
      typeof base.config === "object" && base.config !== null && !Array.isArray(base.config)
        ? ({ ...base.config } as Record<string, unknown>)
        : {};
    delete config.homePath;
    delete config.shadowHomePath;
    for (const key of Object.keys(config)) {
      if (/api.?key|token|secret|password|credential|^auth/i.test(key)) delete config[key];
    }
    const overrides =
      typeof own.config === "object" && own.config !== null && !Array.isArray(own.config)
        ? own.config
        : {};
    const variables = new Map(
      (base.environment ?? [])
        .filter(
          (item) =>
            !item.sensitive &&
            !/(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH|HOME)/i.test(item.name),
        )
        .map((item) => [item.name, item]),
    );
    for (const item of own.environment ?? []) variables.set(item.name, item);
    const next = {
      ...own,
      config: { ...config, ...overrides },
      environment: [...variables.values()],
    };
    resolved.set(id, next);
    return next;
  };
  return Object.fromEntries(Object.keys(instances).map((id) => [id, resolve(id)]));
}

/** Driver-kind ids keep stored selections routable without migration. */
export const defaultInstanceIdForDriver = (driver: ProviderDriverKind): ProviderInstanceId =>
  ProviderInstanceId.make(driver);
