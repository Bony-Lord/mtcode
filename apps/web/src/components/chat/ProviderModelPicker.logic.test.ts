import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { describe, expect, it } from "vite-plus/test";

import {
  providerAccountGroups,
  resolvePickerModel,
  retainedModelWhileProviderLocked,
} from "./ProviderModelPicker.logic";

it("selects app Auto modes outside the native catalog without admitting unknown model names", () => {
  const driver = ProviderDriverKind.make("codex");
  const models = [{ slug: "gpt-5.6-luna", name: "Luna" }];
  for (const mode of ["mt-auto", "mt-auto/fast", "mt-auto/quality", "mt-auto/subscription"]) {
    expect(resolvePickerModel(driver, mode, models)).toBe(mode);
  }
  expect(resolvePickerModel(driver, "mt-auto/nonexistent", models)).toBeNull();
  expect(resolvePickerModel(driver, "gpt-5.6-luna", models)).toBe("gpt-5.6-luna");
});

it("groups saved logins, prefers a ready primary account and keeps gateways separate", () => {
  const entry = (id: string, driver: string, ready = true, primary = false) =>
    ({
      instanceId: ProviderInstanceId.make(id),
      driverKind: ProviderDriverKind.make(driver),
      enabled: true,
      status: ready ? "ready" : "warning",
      isDefault: primary,
    }) as ProviderInstanceEntry;
  const main = entry("codex", "codex", false, true),
    second = entry("codex-second", "codex");
  const groups = providerAccountGroups([
    main,
    second,
    entry("kilo-free", "opencode"),
    entry("ovh-free", "opencode"),
  ]);
  expect(groups).toHaveLength(3);
  expect(groups[0]?.accounts).toEqual([main, second]);
  expect(groups[0]?.representative).toBe(second);
  expect(
    providerAccountGroups([{ ...main, status: "ready" }, second])[0]?.representative.instanceId,
  ).toBe(main.instanceId);
});

const claude = ProviderDriverKind.make("claudeAgent");
const opus = { slug: "claude-opus-5-5", name: "Claude Opus 5.5", shortName: "Opus 5.5" };
const sonnet = { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", shortName: "Sonnet 5.5" };
const retained = (enabled: boolean, isAvailable: boolean, models = [sonnet, opus]) =>
  retainedModelWhileProviderLocked({ driverKind: claude, enabled, isAvailable, models }, opus.slug);

describe("retainedModelWhileProviderLocked", () => {
  it("shows a hidden saved model while its provider cannot run", () => {
    expect(retained(false, true)).toBe(opus);
    expect(retained(true, false)).toBe(opus);
    expect(retained(false, true, [sonnet])).toEqual({ slug: opus.slug, name: opus.slug });
    expect(retained(true, true)).toBeUndefined();
    expect(retainedModelWhileProviderLocked(null, opus.slug)).toBeUndefined();
  });
});
