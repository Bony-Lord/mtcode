import type { DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getAboutUpdateIndicators } from "./AboutUpdateIndicators.logic";

function appState(overrides: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
  return {
    enabled: true,
    status: "up-to-date",
    channel: "latest",
    currentVersion: "0.1.70",
    hostArch: "x64",
    appArch: "x64",
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt: "2026-11-27T00:00:00.000Z",
    message: null,
    errorContext: null,
    canRetry: false,
    ...overrides,
  };
}

describe("getAboutUpdateIndicators", () => {
  it("stays quiet when neither kind of update is available", () => {
    expect(getAboutUpdateIndicators({ appState: appState(), providerUpdateCount: 0 })).toEqual([]);
    expect(getAboutUpdateIndicators({ appState: null, providerUpdateCount: 0 })).toEqual([]);
  });

  it("names the offered app version for every actionable app state", () => {
    for (const state of [
      appState({ status: "available", availableVersion: "0.1.71" }),
      appState({ status: "downloading", availableVersion: "0.1.71", downloadPercent: 40 }),
      appState({ status: "downloaded", downloadedVersion: "0.1.71" }),
    ]) {
      expect(getAboutUpdateIndicators({ appState: state, providerUpdateCount: 0 })).toEqual([
        {
          kind: "app",
          label: "Доступно обновление приложения",
          title: "Версия 0.1.71 доступна для установки",
        },
      ]);
    }
  });

  it("shows provider count and one-click provider names", () => {
    expect(
      getAboutUpdateIndicators({
        appState: appState(),
        providerUpdateCount: 2,
        providerNames: ["Codex", "Claude"],
      }),
    ).toEqual([
      {
        kind: "providers",
        label: "Доступны обновления провайдеров: 2",
        title: "Обновления доступны: Codex, Claude",
      },
    ]);
  });

  it("shows both indicators at once", () => {
    const indicators = getAboutUpdateIndicators({
      appState: appState({ status: "available", availableVersion: "0.1.71" }),
      providerUpdateCount: 1,
      providerNames: ["OpenCode"],
    });
    expect(indicators.map(({ kind }) => kind)).toEqual(["app", "providers"]);
  });
});
