import { describe, expect, it, vi } from "@effect/vitest";

import {
  externalBrowserLaunch,
  listInstalledExternalBrowsers,
  openExternalBrowser,
} from "./externalBrowser.ts";

const URL = "https://auth.openai.com/authorize?state=a%26b&code_challenge=x";

describe("externalBrowserLaunch", () => {
  it("passes an untrusted URL as one argument and rejects unsafe URLs", () => {
    const launch = externalBrowserLaunch(
      URL,
      { browser: "chrome", private: true },
      { LOCALAPPDATA: "C:/User Data" },
      () => true,
      "win32",
    );
    expect(launch?.command).toMatch(/chrome\.exe$/);
    expect(launch?.args).toEqual(["--incognito", URL]);
    expect(
      externalBrowserLaunch(
        URL,
        { browser: "chrome", private: false },
        { LOCALAPPDATA: "C:/User Data" },
        () => true,
        "win32",
      )?.args,
    ).toEqual([URL]);
    expect(
      externalBrowserLaunch(
        "file:///C:/secret",
        { browser: "chrome", private: false },
        {},
        () => true,
        "win32",
      ),
    ).toBeNull();
    expect(
      externalBrowserLaunch(
        "https://user:secret@example.com",
        { browser: "chrome", private: false },
        {},
        () => true,
        "win32",
      ),
    ).toBeNull();
  });

  it("uses the chosen browser's private flag", () => {
    const edge = externalBrowserLaunch(
      URL,
      { browser: "edge", private: true },
      { PROGRAMFILES: "C:/Program Files" },
      () => true,
      "win32",
    );
    expect(edge?.command).toMatch(/msedge\.exe$/);
    expect(edge?.args).toEqual(["--inprivate", URL]);

    const firefox = externalBrowserLaunch(
      URL,
      { browser: "firefox", private: true },
      { PROGRAMFILES: "C:/Program Files" },
      () => true,
      "win32",
    );
    expect(firefox?.args).toEqual(["--private-window", URL]);
  });

  it("keeps system links on the system opener unless private is requested", () => {
    expect(
      externalBrowserLaunch(URL, { browser: "system", private: false }, {}, () => true, "win32"),
    ).toBeNull();
    expect(
      externalBrowserLaunch(
        URL,
        { browser: "system", private: true },
        { PROGRAMFILES: "C:/Program Files" },
        (file) => file.endsWith("chrome.exe"),
        "win32",
      )?.args,
    ).toEqual(["--incognito", URL]);
  });
});

describe("listInstalledExternalBrowsers", () => {
  it("lists only installed supported browsers in a stable order", () => {
    const browsers = listInstalledExternalBrowsers(
      { LOCALAPPDATA: "C:/User Data", PROGRAMFILES: "C:/Program Files" },
      (file) => file.endsWith("chrome.exe") || file.endsWith("firefox.exe"),
      "win32",
    );
    expect(browsers.map((browser) => browser.id)).toEqual(["chrome", "firefox"]);
  });
});

describe("openExternalBrowser", () => {
  it("never falls back to the system opener for a private request", async () => {
    const openSystem = vi.fn(async () => true);
    const opened = await openExternalBrowser(
      URL,
      { browser: "chrome", private: true },
      openSystem,
      { environment: {}, exists: () => false, platform: "win32" },
    );
    expect(opened).toBe(false);
    expect(openSystem).not.toHaveBeenCalled();
  });

  it("uses the system opener for normal system links", async () => {
    const openSystem = vi.fn(async () => true);
    const opened = await openExternalBrowser(
      URL,
      { browser: "system", private: false },
      openSystem,
      { environment: {}, exists: () => false, platform: "win32" },
    );
    expect(opened).toBe(true);
    expect(openSystem).toHaveBeenCalledWith(URL);
  });
});
