import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeURL from "node:url";

const sites = {
  chatgpt: {
    url: "https://chatgpt.com/",
    composer: [
      "ask anything",
      "message chatgpt",
      "спросить chatgpt",
      "спросите что угодно",
      "напишите сообщение",
    ],
    submit: [
      "send prompt",
      "send message",
      "отправить запрос",
      "отправить сообщение",
      '"отправить"',
    ],
    readySelector: '[contenteditable="true"]',
  },
};
class Intervention extends Error {
  constructor(stage, reason, evidence = "") {
    super(reason);
    this.stage = stage;
    this.evidence = evidence.slice(0, 2400);
  }
}
const controls = (snapshot) =>
  snapshot.split("\n").flatMap((line) => {
    const match = /^\s*\[(\d+)\]\s+(.+)$/.exec(line);
    return match ? [{ index: Number(match[1]), label: match[2].toLowerCase() }] : [];
  });
function pickControl(snapshot, names, kind) {
  return controls(snapshot).find(
    ({ label }) => kind.test(label) && names.some((name) => label.includes(name.toLowerCase())),
  )?.index;
}

/** A bounded state machine. The caller receives a specific handoff only if it cannot progress. */
export async function runWebAssistant(
  call,
  {
    site,
    input,
    recipe,
    wait = NodeTimersPromises.setTimeout,
    token = NodeCrypto.randomBytes(6).toString("hex"),
  },
) {
  const defaults = sites[site];
  if (!defaults) throw new Intervention("setup", "This website has no verified runner recipe.");
  if (!input.trim() || input.length > 24000)
    throw new Intervention("setup", "Use a nonempty input up to 24,000 characters.");
  const config = { ...defaults, ...recipe, url: defaults.url };
  const session_id = `web-assistant-${token}`;
  let tab_id;
  let submitted = false;
  const read = (name, args = {}) =>
    call(name, { session_id, ...(tab_id === undefined ? {} : { tab_id }), ...args });
  try {
    const opened = await read("browser_open_tab", { url: config.url });
    tab_id = Number(/tab_id=(\d+)/.exec(opened)?.[1]);
    if (!Number.isSafeInteger(tab_id))
      throw new Intervention("open", "Chrome did not return an agent tab.");
    const snapshot = await read("browser_snapshot", {
      wait_for_selector: config.readySelector,
      wait_timeout_ms: 8500,
    });
    const composer = pickControl(snapshot, config.composer, /textbox|textarea|editable/);
    if (composer === undefined)
      throw new Intervention(
        "composer",
        "The prompt field changed, or the site needs sign-in or a challenge.",
        controls(snapshot)
          .filter(({ label }) => /textbox|textarea|editable/.test(label))
          .map(({ label }) => label)
          .join("\n"),
      );
    const openMarker = `MT_BEGIN_${token}`,
      closeMarker = `MT_END_${token}`;
    const prompt = `${input}\n\nReturn only the requested answer. On separate lines immediately around the answer, print these markers: ${openMarker} and ${closeMarker}.`;
    const filled = await read("browser_fill", {
      index: composer,
      text: prompt,
      return_state: true,
    });
    if (/not exact|did not match|differ from the text|password field/i.test(filled))
      throw new Intervention("fill", "The prompt field did not accept the complete text.");
    const submit = pickControl(filled, config.submit, /button/);
    if (submit === undefined)
      throw new Intervention(
        "submit",
        "The send button changed. The runner has not submitted.",
        controls(filled)
          .filter(({ label }) => /button.*(?:send|отправ)/.test(label))
          .map(({ label }) => label)
          .join("\n"),
      );
    submitted = true;
    await read("browser_click", { index: submit });
    const answerPattern = new RegExp(
      `(?:^|\\n)${openMarker}\\s*\\n([\\s\\S]+?)\\n\\s*${closeMarker}(?:\\s|$)`,
    );
    for (let attempt = 0; attempt < 28; attempt++) {
      await wait(attempt === 0 ? 900 : 2400);
      const page = await read("browser_read", { max_chars: 50000 });
      const answer = answerPattern.exec(page)?.[1]?.trim();
      if (answer) return { status: "completed", site, answer, verified: false };
      if (/verify you are human|captcha|проверка, что вы человек/i.test(page))
        throw new Intervention("challenge", "The site requires the user to handle a challenge.");
    }
    throw new Intervention(
      "answer",
      "The answer could not be verified before the deadline. Inspect the existing site chat before retrying.",
    );
  } catch (error) {
    return {
      status: "needs_help",
      site,
      stage: error.stage ?? "transport",
      reason: error.message,
      evidence: error.evidence ?? "",
      submitMayHaveHappened: submitted,
      tabId: tab_id,
    };
  } finally {
    if (tab_id !== undefined) await read("browser_close_tab").catch(() => {});
  }
}

async function withBrowserBridge(run) {
  const binary =
    process.env.MTCODE_BROWSER_MCP ??
    NodePath.join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "MTCode",
      "resources",
      "munim-computer-use",
      "munim-computer-use.exe",
    );
  const profilePath = NodePath.join(
    process.env.LOCALAPPDATA ?? "",
    "mtcode-desktop",
    "com.munim.mtcode.desktop.json",
  );
  const profile = await NodeFSP.readFile(profilePath, "utf8").then(JSON.parse);
  const paused = NodePath.join(process.env.APPDATA ?? "", "mt", "computer-use.paused");
  const env = {
    ...process.env,
    COMPUTER_USE_PROFILE: JSON.stringify({
      name: "mtcode-desktop",
      envPrefix: "MTCODE_DESKTOP_",
      nativeHostNames: [profile.name],
      extensionIds: ["kgdolgnijopbghhomnblabjkmjhnoage"],
    }),
  };
  const child = NodeChildProcess.spawn(binary, [], {
    env,
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending = new Map();
  let sequence = 0;
  const fail = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  child.once("error", fail);
  child.once("exit", () => fail(Error("The Chrome bridge process stopped.")));
  const lines = NodeReadline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      return;
    }
    const target = pending.get(response.id);
    if (!target) return;
    pending.delete(response.id);
    clearTimeout(target.timer);
    if (response.error) target.reject(Error(response.error.message));
    else target.resolve(response.result);
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`Chrome bridge timed out: ${method}`));
      }, 22000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  child.stdin.on("error", fail);
  try {
    await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mtcode-web-assistant", version: "1" },
    });
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    return await run(async (name, args) => {
      if (
        name !== "browser_close_tab" &&
        (await NodeFSP.access(paused).then(
          () => true,
          () => false,
        ))
      ) {
        throw Error("Computer Use is paused. Resume it in MT Code before using the web helper.");
      }
      const result = await request("tools/call", { name, arguments: args });
      const text =
        result.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n") ?? "";
      if (result.isError) throw Error(text.slice(0, 1200));
      return text;
    });
  } finally {
    child.stdin.end();
    await NodeTimersPromises.setTimeout(100);
    if (child.exitCode === null) child.kill();
  }
}

if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  const [site, source, output] = process.argv.slice(2);
  try {
    if (!site || !source || !output || !Object.hasOwn(sites, site))
      throw Error("Usage: web-assistant-runner.mjs chatgpt INPUT OUTPUT");
    const path = NodePath.join(
      NodeOS.homedir(),
      ".mt",
      "tools",
      "workspace",
      "web-assistant-recipes.json",
    );
    const saved = await NodeFSP.readFile(path, "utf8").then(JSON.parse, () => ({}));
    const input = await NodeFSP.readFile(source, "utf8");
    const result = await withBrowserBridge((call) =>
      runWebAssistant(call, { site, input, recipe: saved[site] }),
    );
    await NodeFSP.writeFile(output, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify({ status: result.status, stage: result.stage, output }));
    if (result.status !== "completed") process.exitCode = 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
