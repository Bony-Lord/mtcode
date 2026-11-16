import { describe, expect, it } from "@effect/vitest";
import { privateBrowserLaunch } from "./privateBrowser.ts";

describe("privateBrowserLaunch", () => {
  it("isolates browser cookies and passes an untrusted URL as one argument", () => {
    const url = "https://auth.openai.com/authorize?state=a%26b&code_challenge=x";
    const launch = privateBrowserLaunch(url, { LOCALAPPDATA: "C:/User Data" }, () => true);
    expect(launch?.command).toMatch(/chrome.exe$/);
    expect(launch?.args).toEqual(["--incognito", url]);
    expect(privateBrowserLaunch("file:///C:/secret", {}, () => true)).toBeNull();
    expect(privateBrowserLaunch("https://user:secret@example.com", {}, () => true)).toBeNull();
    expect(privateBrowserLaunch(url, {}, () => false)).toBeNull();
  });
});
