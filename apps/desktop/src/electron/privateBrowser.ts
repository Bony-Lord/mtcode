// @effect-diagnostics nodeBuiltinImport:off -- A detached interactive browser must outlive the IPC request; use argv without a shell.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** OAuth links only. Pass the URL as an argument, never through a shell. */
export function privateBrowserLaunch(
  rawUrl: string,
  environment: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = NodeFS.existsSync,
): { command: string; args: string[] } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
  const candidates = [
    [environment.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe", "--incognito"],
    [environment.PROGRAMFILES, "Google/Chrome/Application/chrome.exe", "--incognito"],
    [environment["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe", "--inprivate"],
    [environment.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe", "--inprivate"],
    [environment.PROGRAMFILES, "Mozilla Firefox/firefox.exe", "--private-window"],
  ];
  for (const [root, suffix, flag] of candidates) {
    if (!root || !suffix || !flag) continue;
    const command = NodePath.join(root, suffix);
    if (exists(command)) return { command, args: [flag, url.href] };
  }
  return null;
}

export async function openPrivateBrowser(rawUrl: string): Promise<boolean> {
  const launch = privateBrowserLaunch(rawUrl);
  if (!launch) return false;
  return await new Promise<boolean>((resolve) => {
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
