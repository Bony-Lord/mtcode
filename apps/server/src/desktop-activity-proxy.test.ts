// @effect-diagnostics nodeBuiltinImport:off -- Actual child process and local IPC, independent of Electron.
// @effect-diagnostics globalTimers:off -- This test verifies the ordering of real IPC messages.
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeReadline from "node:readline";
import { describe, expect, it } from "@effect/vitest";

describe("desktop activity proxy", () => {
  it("waits for the warning, suppresses default OCR, and interrupts an action on Esc", async () => {
    const name = `mtcode-probe-${NodeCrypto.randomUUID()}`;
    // oxlint-disable-next-line t3code/no-global-process-runtime -- The test launches a real child using the host's IPC path syntax.
    const platform = NodeOS.platform();
    const pipe =
      platform === "win32" ? `\\\\.\\pipe\\${name}` : NodePath.join(NodeOS.tmpdir(), name);
    const phases: string[] = [];
    let activePeer: NodeNet.Socket | undefined;
    let allowInput: (() => void) | undefined;
    let sawPrepare: (() => void) | undefined;
    const prepared = new Promise<void>((resolve) => {
      sawPrepare = resolve;
    });
    const server = NodeNet.createServer((peer) => {
      activePeer = peer;
      NodeReadline.createInterface({ input: peer }).on("line", (line) => {
        const event = JSON.parse(line) as { id: number; phase: string };
        phases.push(event.phase);
        const reply = () => peer.write(`${JSON.stringify({ id: event.id, ok: true })}\n`);
        if (event.phase === "prepare") {
          allowInput = reply;
          sawPrepare?.();
        } else reply();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(pipe, resolve);
    });
    const fixture = `
      import { createInterface } from "node:readline";
      createInterface({ input: process.stdin }).on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.id === 3) { process.stderr.write("native action pending\\n"); return; }
        console.log(JSON.stringify({ id: msg.id, result: msg.params.arguments }));
      });
    `;
    const proxy = new URL("./desktop-activity-proxy.ts", import.meta.url).href;
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { runDesktopActivityProxy } from ${JSON.stringify(proxy)}; runDesktopActivityProxy(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(fixture)}]);`,
      ],
      {
        env: { ...process.env, MTCODE_ACTIVITY_PIPE: pipe },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = NodeReadline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const send = (id: number, name: string) =>
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } })}\n`,
      );
    try {
      send(1, "get_app_state");
      expect(JSON.parse((await lines.next()).value!)).toEqual({ id: 1, result: { ocr: "never" } });
      send(2, "click");
      await prepared;
      expect(phases).toEqual(["check", "prepare"]);
      allowInput?.();
      expect(JSON.parse((await lines.next()).value!)).toEqual({ id: 2, result: {} });
      const passedToNative = new Promise<void>((resolve) =>
        child.stderr.once("data", () => resolve()),
      );
      send(3, "click");
      await new Promise<void>((resolve) => {
        sawPrepare = resolve;
      });
      allowInput?.();
      await passedToNative;
      activePeer?.write('{"event":"escape"}\n');
      const stopped = JSON.parse((await lines.next()).value!);
      expect(stopped.id).toBe(3);
      expect(stopped.result.isError).toBe(true);
    } finally {
      child.stdin.end();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once("exit", () => resolve());
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
