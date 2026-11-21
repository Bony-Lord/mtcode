// Each Codex account keeps its own home and app-server. The registry owns the driver's scope.
import {
  resolveProviderProbeTimeoutMs,
  type ServerProviderDraft,
} from "@t3tools/provider-core/server/snapshotProbe";
import {
  CodexSettings,
  ProviderDriverKind,
  TextGenerationError,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import type * as Signature from "effect/crypto/Signature";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import type * as CodexUsageHistory from "../../usage/CodexUsageHistory.ts";
import { makeCodexTextGeneration } from "../../textGeneration/CodexTextGeneration.ts";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as ServerConfig from "../../config.ts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import {
  createCodexAdapterV2,
  type CodexAdapterV2DriverEnv,
} from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { ProviderDriverError } from "../Errors.ts";
import * as ResetCreditCoordinator from "../resetCreditCoordinator.ts";
import {
  checkCodexProviderStatus,
  makePendingCodexProvider,
  probeCodexSkillsForCwd,
  withCodexAppServerClient,
} from "../CodexProvider.ts";
import { resolveCodexLaunchArgs } from "../codexLaunchArgs.ts";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import * as ModelCatalog from "@t3tools/provider-core/server/ModelCatalog";
import { applyCodexModelCatalog } from "../codexModelCatalog.ts";
import {
  ProviderAdapterCapabilitiesError,
  ProviderAdapterOpenSessionError,
} from "@t3tools/provider-core/server/ProviderAdapter";
import { fromRunner } from "@t3tools/provider-core/server/textGenerationOperations";
import type { ProviderDriver, ProviderInstance } from "@t3tools/provider-core/server/driver";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makeCachedProviderMaintenanceResolution,
  makePackageManagedProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
  type ProviderMaintenanceCapabilities,
} from "@t3tools/provider-core/server/maintenanceResolver";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";
import { makeCodexAccountLogin } from "./CodexAccountLogin.ts";
import {
  codexContinuationIdentity,
  materializeCodexShadowHome,
  resolveCodexHomeLayout,
} from "./CodexHomeLayout.ts";
import { makeManagedCodexProvider } from "./CodexManagedProvider.ts";
import { codexUsageReader } from "./codexUsage.ts";
import * as CodexInstallation from "../CodexInstallation.ts";
import * as CodexManagedTokenBroker from "../CodexManagedTokenBroker.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
const decodeCodexSettings = Schema.decodeSync(CodexSettings);

const DRIVER_KIND = ProviderDriverKind.make("codex");
const CODEX_STANDALONE_HOME_PATTERN = /^(.*)\/packages\/standalone\//is;

function codexStandaloneHome(commandPath: string): string | null {
  // Slash replacement preserves indices; Unicode lowercasing can change the path length.
  const match = CODEX_STANDALONE_HOME_PATTERN.exec(commandPath.replaceAll("\\", "/"));
  if (!match) {
    return null;
  }
  const home = match[1]!;
  // Keep root separators: `C:` is drive-relative, and an empty home is not `/`.
  const isRoot = home === "" || /^[a-z]:$/i.test(home);
  return commandPath.slice(0, home.length + (isRoot ? 1 : 0));
}

// Standalone updates locate their install through CODEX_HOME. Account and auth-overlay
// homes can share an executable, so only the updater uses the executable's owning home.
function makeCodexMaintenanceResolver(sharedHomePath: string) {
  return makePackageManagedProviderMaintenanceResolver({
    provider: DRIVER_KIND,
    npmPackageName: "@openai/codex",
    mise: { tool: "codex" },
    nativeUpdate: {
      args: ["update"],
      isCommandPath: (commandPath) => codexStandaloneHome(commandPath) !== null,
      requiresCommandPath: true,
      env: (context) => ({
        CODEX_HOME:
          codexStandaloneHome(context.realCommandPath) ??
          codexStandaloneHome(context.resolvedCommandPath) ??
          sharedHomePath,
      }),
    },
  });
}

// `codex update` installs this channel's release, which can lag npm's latest tag.
const CODEX_NATIVE_CHANNEL = "https://releases.openai.com/codex/channels/latest";
const CodexNativeRelease = Schema.Struct({ tag_name: Schema.String });

function withCodexNativeLatestVersion(
  capabilities: ProviderMaintenanceCapabilities,
  http: HttpClient.HttpClient,
): ProviderMaintenanceCapabilities {
  if (capabilities.update?.lockKey !== `${DRIVER_KIND}-native`) return capabilities;
  return {
    ...capabilities,
    latestVersion: null,
    latestVersionCacheKey: CODEX_NATIVE_CHANNEL,
    lookupLatestVersion: http.get(CODEX_NATIVE_CHANNEL).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(CodexNativeRelease)),
      Effect.map((release) => /^rust-v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1] ?? null),
      Effect.timeoutOption("4 seconds"),
      Effect.map(Option.getOrNull),
      Effect.orElseSucceed(() => null),
    ),
  };
}

export type CodexDriverEnv =
  | CodexAdapterV2DriverEnv
  | ProviderHost.ProviderHost
  | ChildProcessSpawner.ChildProcessSpawner
  | ResetCreditCoordinator.ResetCreditCoordinator
  | Digest.Digest
  | SecureRandom.SecureRandom
  | Signature.Signature
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | ProviderLatestVersions.ProviderLatestVersions
  | ModelCatalog.ModelCatalog
  | Path.Path
  | ProviderEventLoggers.ProviderEventLoggers
  | ServerConfig.ServerConfig
  | ServerSecretStore.ServerSecretStore
  | ServerEnvironment.ServerEnvironmentIdentity
  | CodexInstallation.CodexInstallation
  | CodexManagedTokenBroker.CodexManagedTokenBroker;

const CODEX_ACCOUNT_LOGIN_ADVERTISEMENT = {
  modes: ["oauth", "deviceCode", "apiKey"],
  supportsLogout: true,
} as const;

export const CodexDriver: ProviderDriver<
  CodexSettings,
  CodexDriverEnv,
  Path.Path | CodexUsageHistory.CodexUsageHistory
> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Codex",
    supportsMultipleInstances: true,
  },
  configSchema: CodexSettings,
  defaultConfig: (): CodexSettings => decodeCodexSettings({}),
  usage: codexUsageReader,
  create: Effect.fn("CodexDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    if (config.setupMode === "managed")
      return yield* makeManagedCodexProvider({
        instanceId,
        displayName,
        accentColor,
        environment,
        enabled,
        config,
      });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const resetCreditCoordinator = yield* ResetCreditCoordinator.ResetCreditCoordinator;
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const httpClient = yield* HttpClient.HttpClient;
    const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
    const installation = yield* CodexInstallation.CodexInstallation;
    const modelCatalog = yield* ModelCatalog.ModelCatalog;
    const currentCatalog = modelCatalog.current(DRIVER_KIND);
    const processEnv = yield* mergeProviderInstanceEnvironment(
      environment,
      yield* HostProcess.Environment,
    );
    const environmentHome = processEnv.CODEX_HOME;
    const quotaHome = config.usageProfile
      ? pathService.join(
          (yield* ServerConfig.ServerConfig).stateDir,
          "codex-usage-profiles",
          "profile-" + encodeURIComponent(instanceId),
        )
      : null;
    if (quotaHome !== null) {
      yield* fileSystem.makeDirectory(quotaHome, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: "Could not create an isolated Codex sign-in directory.",
              cause,
            }),
        ),
      );
    }
    const homeConfig = quotaHome
      ? { ...config, homePath: quotaHome, shadowHomePath: "" }
      : !config.homePath.trim() && environmentHome?.trim()
        ? { ...config, homePath: environmentHome }
        : config;
    const homeLayout = yield* resolveCodexHomeLayout(homeConfig);
    const continuationIdentity = codexContinuationIdentity(homeLayout);
    const stampInstanceIdentity = withInstanceIdentity({
      instanceId,
      driverKind: DRIVER_KIND,
      displayName,
      accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });
    // MT Code advertises the account login modes this driver supports so the
    // client can offer sign-in/sign-out per provider instance.
    const stampIdentity = (snapshot: ServerProviderDraft): ServerProvider => ({
      ...stampInstanceIdentity(snapshot),
      accountLogin: CODEX_ACCOUNT_LOGIN_ADVERTISEMENT,
    });
    yield* materializeCodexShadowHome(homeLayout).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: cause.message,
            cause,
          }),
      ),
    );
    const configuredBinaryPath = expandHomePath(
      config.binaryPath,
      yield* HostProcess.HomeDirectory,
    );
    const followsSharedInstallation =
      config.usageProfile ||
      CodexInstallation.isManagedCodexBinaryPath(
        pathService.relative(installation.managedDirectory, configuredBinaryPath),
        pathService.sep,
        yield* HostProcess.Platform,
      );
    // Older setups stored the versioned path of MT's own install in each account.
    const sharedExecutable = followsSharedInstallation
      ? installation.acquire().pipe(
          Effect.map((executable) => executable.executablePath),
          Effect.orElseSucceed(() => configuredBinaryPath),
        )
      : undefined;
    const effectiveConfig = {
      ...config,
      enabled,
      binaryPath: sharedExecutable ? yield* Effect.scoped(sharedExecutable) : configuredBinaryPath,
      homePath: homeLayout.effectiveHomePath ?? "",
    } satisfies CodexSettings;
    if (config.usageProfile) {
      const host = yield* ProviderHost.ProviderHost;
      const quotaEnv = {
        ...processEnv,
        OPENAI_API_KEY: undefined,
        OPENAI_BASE_URL: undefined,
        ACCESS_TOKEN: undefined,
        T3CODE_CODEX_LAUNCH_ARGS: undefined,
      };
      const quotaConfig = { ...effectiveConfig, launchArgs: "" };
      const accountLogin = {
        ...makeCodexAccountLogin({
          instanceId,
          config: quotaConfig,
          environment: quotaEnv,
          spawner,
        }),
        modes: ["oauth", "deviceCode"] as const,
      };
      const quotaSnapshot = (value: ServerProviderDraft) =>
        stampInstanceIdentity({
          ...value,
          models: [],
          supportsTextGeneration: false,
          ...(value.status === "ready"
            ? { status: "warning", message: "This Codex profile is used for usage limits." }
            : {}),
          accountLogin: { modes: accountLogin.modes, supportsLogout: true },
        });
      const pending = makePendingCodexProvider(quotaConfig).pipe(Effect.map(quotaSnapshot));
      const check = Effect.gen(function* () {
        const settings = sharedExecutable
          ? { ...quotaConfig, binaryPath: yield* Effect.scoped(sharedExecutable) }
          : quotaConfig;
        return quotaSnapshot(yield* checkCodexProviderStatus(settings, undefined, quotaEnv));
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, pathService),
      );
      const snapshot = yield* makeManagedServerProvider({
        resolveMaintenance: () =>
          Effect.succeed({ provider: DRIVER_KIND, packageName: null, update: null }),
        getSettings: host.settings.get,
        streamSettings: host.settings.changes,
        haveSettingsChanged: () => false,
        initialSnapshot: () => pending,
        checkProvider: check,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: "Could not prepare the Codex usage profile.",
              cause,
            }),
        ),
      );
      const unavailable = "This Codex profile is used for usage limits.";
      const rejectCapabilities = () =>
        Effect.fail(
          new ProviderAdapterCapabilitiesError({
            driver: DRIVER_KIND,
            cause: unavailable,
          }),
        );
      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        enabled,
        displayName,
        accentColor,
        snapshot,
        accountLogin,
        orchestrationAdapter: {
          instanceId,
          driver: DRIVER_KIND,
          getCapabilities: rejectCapabilities,
          planSelectionTransition: rejectCapabilities,
          openSession: (input) =>
            Effect.fail(
              new ProviderAdapterOpenSessionError({
                driver: DRIVER_KIND,
                providerSessionId: input.providerSessionId,
                cause: unavailable,
              }),
            ),
        },
        textGeneration: fromRunner("CodexQuotaProfile", ({ operation }) =>
          Effect.fail(new TextGenerationError({ operation, detail: unavailable })),
        ),
      } satisfies ProviderInstance;
    }

    const latestNativeConfig = sharedExecutable
      ? sharedExecutable.pipe(Effect.map((binaryPath) => ({ ...effectiveConfig, binaryPath })))
      : Effect.succeed(effectiveConfig);
    const resolveInstallation = yield* makeCachedProviderMaintenanceResolution(
      latestNativeConfig.pipe(
        Effect.flatMap(({ binaryPath }) =>
          resolveProviderMaintenanceCapabilitiesEffect(
            makeCodexMaintenanceResolver(homeLayout.sharedHomePath),
            { binaryPath, env: processEnv },
          ),
        ),
        Effect.scoped,
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, pathService),
      ),
    );
    const resolveMaintenance: typeof resolveInstallation = (options) =>
      resolveInstallation(options).pipe(
        Effect.map((capabilities) => withCodexNativeLatestVersion(capabilities, httpClient)),
      );

    const orchestrationAdapter = yield* createCodexAdapterV2(
      {
        instanceId,
        displayName,
        accentColor,
        environment,
        enabled,
        config: homeConfig,
      },
      {
        onUsageLimits: (update) => snapshot.applyUsageLimits(update),
        ...(sharedExecutable ? { resolveExecutable: sharedExecutable } : {}),
        models: Effect.suspend(() => snapshot.getSnapshot).pipe(
          Effect.map((value) => value.models),
        ),
        compatibility: installation.compatibility,
      },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Failed to build Codex orchestration adapter.",
            cause,
          }),
      ),
    );

    // Kick the TTL-gated manifest refresh in the background and classify with the in-memory
    // manifest, so a slow or hung fetch never delays the provider check.
    const checkProvider = modelCatalog.refreshInBackground.pipe(
      Effect.andThen(
        Effect.zipWith(
          latestNativeConfig.pipe(
            Effect.flatMap((settings) => checkCodexProviderStatus(settings, undefined, processEnv)),
            Effect.scoped,
          ),
          currentCatalog,
          (draft, catalog) => stampIdentity(applyCodexModelCatalog(draft, catalog)),
          { concurrent: true },
        ),
      ),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, pathService),
    );
    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<CodexSettings>>({
      resolveMaintenance,
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      initialSnapshot: (settings) =>
        Effect.zipWith(
          makePendingCodexProvider(settings.provider),
          currentCatalog,
          (draft, catalog) => stampIdentity(applyCodexModelCatalog(draft, catalog)),
        ),
      checkProvider,
      enrichSnapshot: ({ settings, snapshot, publishSnapshot }) =>
        resolveMaintenance().pipe(
          Effect.flatMap((maintenanceCapabilities) =>
            enrichProviderSnapshotWithVersionAdvisory(snapshot, maintenanceCapabilities, {
              enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
            }),
          ),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.provideService(ProviderLatestVersions.ProviderLatestVersions, latestVersions),
          Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
        ),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: `Failed to build Codex snapshot: ${cause.message ?? String(cause)}`,
            cause,
          }),
      ),
    );
    const textGeneration = yield* makeCodexTextGeneration(
      effectiveConfig,
      processEnv,
      snapshot.getSnapshot.pipe(Effect.map((value) => value.models)),
      latestNativeConfig.pipe(Effect.map((config) => ({ config, environment: processEnv }))),
    );
    const snapshotForCwd = (cwd: string) =>
      !effectiveConfig.enabled
        ? snapshot.getSnapshot
        : Effect.all([
            snapshot.getSnapshot,
            latestNativeConfig.pipe(
              Effect.flatMap((settings) =>
                probeCodexSkillsForCwd({
                  binaryPath: settings.binaryPath,
                  homePath: settings.homePath,
                  launchArgs: resolveCodexLaunchArgs(settings.launchArgs, processEnv),
                  cwd,
                  environment: processEnv,
                }),
              ),
              Effect.scoped,
              Effect.timeout(resolveProviderProbeTimeoutMs("codex", 20_000, processEnv)),
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            ),
          ]).pipe(
            Effect.map(([machineSnapshot, skills]) => ({ ...machineSnapshot, skills })),
            Effect.mapError(
              (cause) =>
                new ProviderDriverError({
                  driver: DRIVER_KIND,
                  instanceId,
                  detail: `Failed to probe Codex skills for '${cwd}'`,
                  cause,
                }),
            ),
          );

    // Redemption spends account credit; serialize by the auth.json directory, keep one idempotency key
    // until the outcome, and bound the wait so a hung app-server cannot hold the account lock.
    // Auth overlays use effectiveHomePath; the continuation key would conflate them with shared homes.
    const accountKey = homeLayout.effectiveHomePath ?? homeLayout.sharedHomePath;
    const consumeResetCredit: NonNullable<ProviderInstance["consumeResetCredit"]> = () =>
      resetCreditCoordinator
        .redeem(accountKey, (idempotencyKey) =>
          Effect.gen(function* () {
            const settings = yield* latestNativeConfig;
            const { client } = yield* withCodexAppServerClient({
              binaryPath: settings.binaryPath,
              homePath: settings.homePath,
              launchArgs: resolveCodexLaunchArgs(settings.launchArgs, processEnv),
              cwd: process.cwd(),
              environment: processEnv,
            });
            const response = yield* client.request("account/rateLimitResetCredit/consume", {
              idempotencyKey,
            });
            return response.outcome;
          }).pipe(Effect.scoped, Effect.timeout("20 seconds")),
        )
        .pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.mapError(
            (cause) =>
              new ProviderDriverError({
                driver: DRIVER_KIND,
                instanceId,
                detail: "Codex could not redeem the reset credit.",
                cause,
              }),
          ),
          Effect.tap((outcome) =>
            ResetCreditCoordinator.refreshAfterRedemption({
              outcome,
              getSnapshot: snapshot.getSnapshot,
              refresh: snapshot.refresh,
            }).pipe(
              Effect.filterOrFail(
                (confirmed) => confirmed,
                () =>
                  new ProviderDriverError({
                    driver: DRIVER_KIND,
                    instanceId,
                    detail:
                      "The reset was applied, but Codex could not confirm the new limits. Refresh to check.",
                  }),
              ),
            ),
          ),
        );

    // `codex login` and `codex logout` rewrite auth.json outside T3.
    if (effectiveConfig.enabled) {
      yield* fileSystem.watch(accountKey).pipe(
        Stream.filter((event) => pathService.basename(event.path) === "auth.json"),
        Stream.debounce(Duration.millis(250)),
        Stream.runForEach(() => snapshot.refresh.pipe(Effect.ignoreCause({ log: true }))),
        Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
        Effect.ignoreCause({ log: true }),
        Effect.forkScoped,
      );
    }
    return {
      instanceId,
      driverKind: DRIVER_KIND,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      snapshot,
      snapshotForCwd,
      consumeResetCredit,
      orchestrationAdapter,
      textGeneration,
      accountLogin: makeCodexAccountLogin({
        instanceId,
        config: effectiveConfig,
        environment: processEnv,
        spawner,
      }),
    } satisfies ProviderInstance;
  }),
};
