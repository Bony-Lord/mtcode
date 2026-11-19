import { expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ServerSettingsService } from "../serverSettings.ts";
import { freeTextCatalog, syncFreeModelCatalogs } from "./FreeModelCatalog.ts";

it("keeps only explicitly zero-priced text models when refreshing a mixed catalog", () => {
  const pricing = { prompt: "0", completion: "0" };
  const free = { id: "free-chat", pricing, architecture: { output_modalities: ["text"] } };
  expect(
    freeTextCatalog([
      free,
      { id: "unknown" },
      { id: "paid", pricing: { prompt: "0.002", completion: "0" } },
      { id: "dynamic-price", pricing: { prompt: "-1", completion: "-1" } },
      { id: "audio", pricing, architecture: { output_modalities: ["text", "audio"] } },
      { id: "empty-price", pricing: { prompt: "", completion: "" } },
    ]),
  ).toEqual([free]);
});

it.effect(
  "refreshing a catalog preserves every other provider and the target connection settings",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "mt-free-catalog-" });
      const filename = path.join(home, "catalog.json");
      yield* fs.writeFileString(
        filename,
        JSON.stringify({ provider: { "kilo-free": { models: { old: { name: "Old" } } } } }),
      );
      const codex = {
        driver: ProviderDriverKind.make("codex"),
        enabled: true as const,
        accountTier: "subscription" as const,
      };
      const kilo = {
        driver: ProviderDriverKind.make("opencode"),
        enabled: true as const,
        accountTier: "free" as const,
        environment: [{ name: "OPENCODE_CONFIG", value: filename, sensitive: false }],
        config: {
          configuredCatalogOnly: true,
          binaryPath: "preserved-executable",
          customModels: ["kilo-free/old"],
        },
      };
      const program = Effect.gen(function* () {
        const result = yield* syncFreeModelCatalogs();
        expect(Object.keys(result.providerInstances).sort()).toEqual(["codex", "kilo-free"]);
        expect(result.providerInstances[ProviderInstanceId.make("codex")]).toEqual(codex);
        const refreshed = result.providerInstances[ProviderInstanceId.make("kilo-free")];
        expect(refreshed?.environment).toEqual(kilo.environment);
        expect(refreshed?.config).toMatchObject({
          binaryPath: "preserved-executable",
          configuredCatalogOnly: true,
        });
        expect(refreshed?.config).toMatchObject({
          customModels: [{ slug: "kilo-free/new-free", name: "New free" }],
        });
      });
      yield* program.pipe(
        Effect.provide(
          ServerSettingsService.layerTest({
            ...DEFAULT_SERVER_SETTINGS,
            providerInstances: {
              [ProviderInstanceId.make("codex")]: codex,
              [ProviderInstanceId.make("kilo-free")]: kilo,
            },
          }),
        ),
        Effect.provideService(HostProcess.HomeDirectory, home),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json({
                  data: [
                    { id: "new-free", name: "New free", pricing: { prompt: "0", completion: "0" } },
                  ],
                }),
              ),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
