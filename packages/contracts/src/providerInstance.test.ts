import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ProviderInstanceEnvironmentVariable,
  ProviderInstanceConfigMap,
  resolveProviderInstanceProfiles,
} from "./providerInstance.ts";

const decodeEnvironmentVariable = Schema.decodeUnknownSync(ProviderInstanceEnvironmentVariable);
const decodeInstances = Schema.decodeUnknownSync(ProviderInstanceConfigMap);

it("inherits changing common settings and keeps account credentials private", () => {
  const source = decodeInstances({
    codex: {
      driver: "codex",
      usagePolicy: { sessionMaxUsedPercent: 25, weeklyMaxUsedPercent: 4 },
      config: { binaryPath: "shared.exe", homePath: "main-home", apiKey: "private" },
      environment: [{ name: "OPENAI_API_KEY", value: "private", sensitive: true }],
    },
    account: {
      driver: "codex",
      settingsProfileId: "codex",
      config: { setupMode: "managed", shadowHomePath: "account-home" },
    },
  });
  const resolved = resolveProviderInstanceProfiles(source).account!;
  expect(resolved.usagePolicy).toBeUndefined();
  expect(resolved.config).toEqual({
    binaryPath: "shared.exe",
    setupMode: "managed",
    shadowHomePath: "account-home",
  });
  expect(resolved.environment).toEqual([]);
  const changed = { ...source, codex: { ...source.codex!, config: { binaryPath: "updated.exe" } } };
  expect(resolveProviderInstanceProfiles(changed).account!.config).toMatchObject({
    binaryPath: "updated.exe",
  });
});

describe("ProviderInstanceEnvironmentVariable", () => {
  it("treats a stored reference as sensitive even when the flag is missing or false", () => {
    const secret = { provider: "onepassword", reference: "op://Private/item/field" };
    expect(decodeEnvironmentVariable({ name: "API_KEY", secret })).toMatchObject({
      value: secret,
      sensitive: true,
    });
    expect(decodeEnvironmentVariable({ name: "API_KEY", sensitive: false, secret }).sensitive).toBe(
      true,
    );
  });
});
