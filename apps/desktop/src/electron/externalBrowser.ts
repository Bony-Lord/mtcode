// @effect-diagnostics nodeBuiltinImport:off -- A detached interactive browser must outlive the IPC request; use argv without a shell.
import type { ExternalBrowserId, ExternalBrowserOption } from "@t3tools/contracts";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** User-facing choice for links and sign-in pages opened outside MT Code. */
export interface ExternalBrowserPreference {
  readonly browser: ExternalBrowserId;
  readonly private: boolean;
}

interface BrowserDefinition {
  readonly id: Exclude<ExternalBrowserId, "system">;
  readonly name: string;
  readonly privateFlag: string;
  readonly windows: readonly (readonly [string, string])[];
  readonly mac: readonly string[];
  readonly linux: readonly string[];
}

/**
 * Supported browsers, in the order used when "system" + private needs a
 * fallback. The in-app preview browser and remote/web clients never use this.
 */
const BROWSERS: readonly BrowserDefinition[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    privateFlag: "--incognito",
    windows: [
      ["LOCALAPPDATA", "Google/Chrome/Application/chrome.exe"],
      ["PROGRAMFILES", "Google/Chrome/Application/chrome.exe"],
      ["PROGRAMFILES(X86)", "Google/Chrome/Application/chrome.exe"],
    ],
    mac: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    privateFlag: "--inprivate",
    windows: [
      ["PROGRAMFILES", "Microsoft/Edge/Application/msedge.exe"],
      ["PROGRAMFILES(X86)", "Microsoft/Edge/Application/msedge.exe"],
      ["LOCALAPPDATA", "Microsoft/Edge/Application/msedge.exe"],
    ],
    mac: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    linux: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
  },
  {
    id: "firefox",
    name: "Mozilla Firefox",
    privateFlag: "--private-window",
    windows: [
      ["PROGRAMFILES", "Mozilla Firefox/firefox.exe"],
      ["PROGRAMFILES(X86)", "Mozilla Firefox/firefox.exe"],
      ["LOCALAPPDATA", "Mozilla Firefox/firefox.exe"],
    ],
    mac: ["/Applications/Firefox.app/Contents/MacOS/firefox"],
    linux: ["/usr/bin/firefox"],
  },
  {
    id: "brave",
    name: "Brave",
    privateFlag: "--incognito",
    windows: [
      ["LOCALAPPDATA", "BraveSoftware/Brave-Browser/Application/brave.exe"],
      ["PROGRAMFILES", "BraveSoftware/Brave-Browser/Application/brave.exe"],
    ],
    mac: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
    linux: ["/usr/bin/brave-browser", "/usr/bin/brave"],
  },
];

/** http(s) only, with no embedded credentials. */
function safeHttpUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function candidatePaths(
  browser: BrowserDefinition,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  if (platform === "darwin") return [...browser.mac];
  if (platform === "linux") return [...browser.linux];
  if (platform !== "win32") return [];
  return browser.windows.flatMap(([rootKey, suffix]) => {
    const root = environment[rootKey];
    return root ? [NodePath.win32.join(root, suffix)] : [];
  });
}

function executablePath(
  browser: BrowserDefinition,
  environment: NodeJS.ProcessEnv,
  exists: (file: string) => boolean,
  platform: NodeJS.Platform,
): string | null {
  return (
    candidatePaths(browser, environment, platform).find((candidate) => exists(candidate)) ?? null
  );
}

/** Supported browsers this computer actually has, for the settings choice. */
export function listInstalledExternalBrowsers(
  environment: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = NodeFS.existsSync,
  platform: NodeJS.Platform = process.platform,
): ExternalBrowserOption[] {
  return BROWSERS.filter(
    (browser) => executablePath(browser, environment, exists, platform) !== null,
  ).map((browser) => ({ id: browser.id, name: browser.name }));
}

/**
 * Resolves the command for a preference. `null` means "use the system opener"
 * for normal links, but a private request must never fall back to a normal
 * window: callers treat `null` as a failure when `private` is true.
 */
export function externalBrowserLaunch(
  rawUrl: string,
  preference: ExternalBrowserPreference,
  environment: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = NodeFS.existsSync,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } | null {
  const url = safeHttpUrl(rawUrl);
  if (!url) return null;

  const selected =
    preference.browser === "system"
      ? undefined
      : BROWSERS.find((browser) => browser.id === preference.browser);
  const browser =
    selected ??
    (preference.private
      ? BROWSERS.find(
          (candidate) => executablePath(candidate, environment, exists, platform) !== null,
        )
      : undefined);
  if (!browser) return null;

  const command = executablePath(browser, environment, exists, platform);
  if (!command) return null;
  return {
    command,
    args: preference.private ? [browser.privateFlag, url.href] : [url.href],
  };
}

function spawnDetached(launch: { command: string; args: string[] }): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = NodeChildProcess.spawn(launch.command, launch.args, {
      shell: false,
      detached: true,
      stdio: "ignore",
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

/**
 * Opens a URL with the preferred external browser. A private request returns
 * false when no supported private window exists rather than leaking the URL to
 * a normal browser.
 */
export async function openExternalBrowser(
  rawUrl: string,
  preference: ExternalBrowserPreference,
  openSystem: (url: string) => Promise<boolean>,
  launchOptions: {
    readonly environment?: NodeJS.ProcessEnv;
    readonly exists?: (file: string) => boolean;
    readonly platform?: NodeJS.Platform;
  } = {},
): Promise<boolean> {
  if (!safeHttpUrl(rawUrl)) return false;
  const launch = externalBrowserLaunch(
    rawUrl,
    preference,
    launchOptions.environment,
    launchOptions.exists,
    launchOptions.platform,
  );
  if (launch) return await spawnDetached(launch);
  if (preference.private) return false;
  return await openSystem(rawUrl);
}
