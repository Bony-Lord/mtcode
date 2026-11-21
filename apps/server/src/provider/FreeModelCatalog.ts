import {
  buildGatewayConnectionPlan,
  gatewayModelIds,
  gatewayPreset,
  type GatewayConnectInput,
  type CustomModelSetting,
  ProviderInstanceId,
  ServerSettingsError,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ServerSettingsService } from "../serverSettings.ts";
import { ServerConfig } from "../config.ts";

const price = Schema.Union([Schema.String, Schema.Number]);
const remoteModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  pricing: Schema.optionalKey(
    Schema.Struct({ prompt: Schema.optionalKey(price), completion: Schema.optionalKey(price) }),
  ),
  architecture: Schema.optionalKey(
    Schema.Struct({ output_modalities: Schema.optionalKey(Schema.Array(Schema.String)) }),
  ),
  output_modalities: Schema.optionalKey(Schema.Array(Schema.String)),
  context_length: Schema.optionalKey(Schema.Number),
  max_output_tokens: Schema.optionalKey(Schema.Number),
});
type RemoteModel = typeof remoteModel.Type;
type NativeProvider = {
  models?: Record<string, { name?: string; [key: string]: unknown }>;
  [key: string]: unknown;
};
type NativeConfig = { provider: Record<string, NativeProvider>; [key: string]: unknown };
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeModels = Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Array(remoteModel) }));
const decodeProviderModels = Schema.decodeUnknownEffect(
  Schema.Struct({ models: Schema.Array(remoteModel) }),
);
const decodeKey = Schema.decodeUnknownEffect(Schema.Struct({ key: Schema.String }));
const decodeConnections = Schema.decodeUnknownEffect(
  Schema.Struct({
    connections: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        provider: Schema.String,
        isActive: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  }),
);
const gatewayWrites = Semaphore.makeUnsafe(1);

export function freeTextCatalog(models: readonly RemoteModel[]) {
  const isZero = (price: unknown) =>
    (typeof price === "number" || (typeof price === "string" && price.trim() !== "")) &&
    Number(price) === 0;
  return models.filter(
    (model) =>
      typeof model.id === "string" &&
      isZero(model.pricing?.prompt) &&
      isZero(model.pricing?.completion) &&
      (model.architecture?.output_modalities ?? model.output_modalities ?? ["text"]).every(
        (kind) => kind === "text",
      ),
  );
}

export const connectGatewayPreset = Effect.fn("FreeModelCatalog.connectGatewayPreset")(function* (
  input: GatewayConnectInput,
) {
  const service = yield* ServerSettingsService;
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settings = yield* service.getSettings;
  const preset = gatewayPreset(input.presetId);
  const instanceId = ProviderInstanceId.make(preset.providerInstanceId);
  const current = settings.providerInstances[instanceId];
  const failure = (detail: string) =>
    new ServerSettingsError({
      settingsPath: config.settingsPath,
      providerInstanceId: instanceId,
      operation: "connect-gateway",
      detail,
    });
  const upsert = (instance: NonNullable<typeof current>) =>
    service.updateProviderInstance({ operation: "upsert", instanceId, instance });

  if (input.presetId === "omniroute" && current?.driver === "acpRegistry") {
    const { freeAccountPaused: _paused, ...instance } = current;
    return yield* upsert({ ...instance, enabled: true });
  }

  const gatewayDir = path.join(config.stateDir, "gateways");
  let configPath = path.join(gatewayDir, "local-openai.json");
  let agent: { commandPath: string; commandArgs: string[] } | undefined;
  if (input.presetId === "omniroute") {
    const workspace = path.join(yield* HostProcess.HomeDirectory, ".mt", "tools", "workspace");
    const script = path.join(workspace, "web-assistant-acp.mjs");
    configPath = path.join(workspace, "opencode-omniroute.json");
    const node = yield* resolveCommandPath("node").pipe(Effect.orElseSucceed(() => null));
    const [agentExists, configExists] = yield* Effect.all([
      fs.exists(script),
      fs.exists(configPath),
    ]).pipe(Effect.orElseSucceed(() => [false, false]));
    if (!node || !agentExists || !configExists) {
      return yield* failure("OmniRoute and its MT Code agent must be installed on this computer.");
    }
    agent = { commandPath: node, commandArgs: [script] };
  } else if (gatewayModelIds(input.models ?? []).length === 0) {
    return yield* failure("Enter at least one model ID advertised by the local endpoint.");
  }

  const result = buildGatewayConnectionPlan({ ...input, configPath, ...(agent ? { agent } : {}) });
  if (!result.ok) return yield* failure(result.error);
  const { plan } = result;
  if (current && current.driver !== plan.providerInstance.driver) {
    return yield* failure("The gateway name is already used by a different provider.");
  }
  const save = upsert({
    ...current,
    ...plan.providerInstance,
    providerGroup: preset.label,
  });
  const configFile = plan.configFile;
  if (!configFile) return yield* save;
  const write = (contents: string) => writeFileStringAtomically({ filePath: configPath, contents });
  return yield* gatewayWrites.withPermit(
    Effect.gen(function* () {
      const previous = yield* fs.exists(configPath).pipe(
        Effect.flatMap((exists) =>
          exists
            ? fs.readFileString(configPath).pipe(Effect.map(Option.some))
            : Effect.succeed(Option.none()),
        ),
        Effect.mapError(() => failure("Could not read the existing local gateway configuration.")),
      );
      yield* fs.makeDirectory(gatewayDir, { recursive: true }).pipe(
        Effect.andThen(write(configFile.contents)),
        Effect.mapError(() => failure("Could not save the local gateway configuration.")),
      );
      return yield* save.pipe(
        Effect.onError(() =>
          (Option.isSome(previous)
            ? write(previous.value)
            : fs.remove(configPath, { force: true })
          ).pipe(Effect.ignore),
        ),
      );
    }),
  );
});

export const syncFreeModelCatalogs = Effect.fn("FreeModelCatalog.sync")(function* () {
  const service = yield* ServerSettingsService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const http = yield* HttpClient.HttpClient;
  const settings = yield* service.getSettings;
  const base = path.join(home, ".mt");
  const failed: string[] = [];
  const readJson = (filename: string) =>
    fs.readFileString(filename).pipe(Effect.flatMap(decodeJson));
  const get = (url: string, headers: Record<string, string> = {}) =>
    http.get(url, { headers }).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.timeout("20 seconds"),
    );
  for (const id of ["kilo-free", "opencode-free", "omniroute-free"]) {
    const instanceId = ProviderInstanceId.make(id);
    const instance = settings.providerInstances[instanceId];
    const gatewayChat =
      id === "omniroute-free" &&
      instance?.driver === "acpRegistry" &&
      instance.environment?.some(
        (entry) => entry.name === "MT_CHAT_PROVIDER" && entry.value === "omniroute",
      );
    if (
      !instance?.enabled ||
      (!gatewayChat &&
        (instance.driver !== "opencode" ||
          (instance.config as { configuredCatalogOnly?: boolean })?.configuredCatalogOnly !== true))
    )
      continue;
    const filename = instance.environment?.find((entry) => entry.name === "OPENCODE_CONFIG")?.value;
    if (typeof filename !== "string" || !path.isAbsolute(filename)) continue;
    yield* Effect.gen(function* () {
      const originalText = yield* fs.readFileString(filename);
      const native = (yield* decodeJson(originalText)) as NativeConfig;
      const existing = (
        (instance.config as { customModels?: CustomModelSetting[] })?.customModels ?? []
      ).map((model) => (typeof model === "string" ? { slug: model } : model));
      const known = new Map(existing.map((model) => [model.slug, model]));
      const customModels: CustomModelSetting[] = [];
      const replace = (providerId: string, models: readonly RemoteModel[]) => {
        if (!models.length) return;
        const provider = native.provider?.[providerId];
        if (!provider) return;
        const prior = provider.models ?? {};
        provider.models = Object.fromEntries(
          models.map((model) => [
            model.id,
            {
              ...prior[model.id],
              name: model.name ?? prior[model.id]?.name ?? model.id,
              cost: { input: 0, output: 0 },
              ...(model.context_length
                ? {
                    limit: {
                      context: model.context_length,
                      output: model.max_output_tokens ?? 4096,
                    },
                  }
                : {}),
            },
          ]),
        );
        for (const model of models) {
          const slug = `${providerId}/${model.id}`;
          customModels.push(known.get(slug) ?? { slug, name: model.name ?? model.id });
        }
      };
      if (id === "kilo-free") {
        const result = yield* get("https://api.kilo.ai/api/openrouter/models").pipe(
          Effect.flatMap(decodeModels),
        );
        replace("kilo-free", freeTextCatalog(result.data ?? []));
      } else if (id === "opencode-free") {
        const result = yield* get("https://opencode.ai/zen/v1/models").pipe(
          Effect.flatMap(decodeModels),
        );
        replace(
          "opencode",
          (result.data ?? []).filter(
            (model: RemoteModel) => model.id === "big-pickle" || model.id.endsWith("-free"),
          ),
        );
        customModels.push(...existing.filter((model) => !model.slug.startsWith("opencode/")));
      } else {
        const { key } = yield* readJson(path.join(base, "omniroute", "mt-key.json")).pipe(
          Effect.flatMap(decodeKey),
        );
        const result = yield* get("http://127.0.0.1:20128/v1/models?kind=chat&prefix=alias", {
          Authorization: `Bearer ${key}`,
        }).pipe(Effect.flatMap(decodeModels));
        const models: RemoteModel[] = [...freeTextCatalog(result.data ?? [])];
        const cookie = yield* fs
          .readFileString(path.join(base, "omniroute", "setup-cookie.txt"))
          .pipe(Effect.orElseSucceed(() => ""));
        if (cookie.trim()) {
          yield* Effect.gen(function* () {
            const connections = yield* get("http://127.0.0.1:20128/api/providers", {
              cookie: cookie.trim(),
            }).pipe(Effect.flatMap(decodeConnections));
            const cloudflare = connections.connections?.find(
              (connection: { provider: string; isActive?: boolean }) =>
                connection.provider === "cloudflare-playground" && connection.isActive !== false,
            );
            if (!cloudflare) return;
            const discovered = yield* get(
              `http://127.0.0.1:20128/api/providers/${encodeURIComponent(cloudflare.id)}/models`,
              { cookie: cookie.trim() },
            ).pipe(Effect.flatMap(decodeProviderModels));
            for (const model of discovered.models ?? []) {
              if (
                typeof model.id === "string" &&
                !models.some((entry) => entry.id === `cfp/${model.id}`)
              )
                models.push({ ...model, id: `cfp/${model.id}` });
            }
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => {
                failed.push("Cloudflare");
                for (const [id, model] of Object.entries(
                  native.provider?.omniroute?.models ?? {},
                )) {
                  if (id.startsWith("cfp/"))
                    models.push({ id, ...(model.name ? { name: model.name } : {}) });
                }
              }),
            ),
          );
        }
        replace("omniroute", models);
      }
      if (!customModels.length) return;
      if ((yield* fs.readFileString(filename)) !== originalText) return;
      const latest = (yield* service.getSettings).providerInstances[instanceId];
      if (latest?.driver !== instance.driver) return;
      const nextText = yield* encodeJson(native);
      yield* writeFileStringAtomically({ filePath: filename, contents: nextText });
      const modelSettings = gatewayChat
        ? customModels.map((model) => (typeof model === "string" ? model : model.slug))
        : customModels;
      yield* service
        .updateProviderInstance({
          operation: "upsert",
          instanceId,
          instance: {
            ...latest,
            config: { ...(latest.config as Record<string, unknown>), customModels: modelSettings },
          },
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.gen(function* () {
              if ((yield* fs.readFileString(filename)) === nextText) {
                yield* writeFileStringAtomically({ filePath: filename, contents: originalText });
              }
              return yield* cause;
            }),
          ),
        );
      if (id === "omniroute-free") {
        const routesPath = path.join(base, "tools", "workspace", "assistant-routes.json");
        const routes = yield* readJson(routesPath);
        if (Array.isArray(routes)) {
          const updated = [
            ...routes.filter(
              (route: { id?: string }) => !route.id?.startsWith("configured/omniroute/"),
            ),
            ...Object.keys(native.provider.omniroute?.models ?? {}).map((model) => ({
              id: `configured/omniroute/${model}`,
              endpoint: "http://127.0.0.1:20128/v1/chat/completions",
              model,
              credential: "omni-inference",
              zeroCost: true,
              domains: [
                "extraction",
                "classification",
                "draft",
                "code-draft",
                "code-review",
                "reasoning-draft",
              ],
              evidence: "catalog-only",
              confidence: "provisional",
            })),
          ];
          yield* writeFileStringAtomically({
            filePath: routesPath,
            contents: yield* encodeJson(updated),
          });
        }
      }
    }).pipe(
      Effect.catch((cause) =>
        Effect.sync(() => failed.push(id)).pipe(
          Effect.andThen(
            Effect.logWarning("Free model catalog kept its previous entries", {
              instanceId,
              cause: String(cause),
            }),
          ),
        ),
      ),
    );
  }
  if (failed.length)
    return yield* new ServerSettingsError({
      operation: "refresh-free-models",
      settingsPath: base,
      providerInstanceId: failed.join(", "),
    });
  return yield* service.getSettings;
});
