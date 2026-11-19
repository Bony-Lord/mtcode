import assert from "node:assert/strict";
import { test } from "node:test";
import { runRepairThread } from "./web-assistant-repair.mjs";

test("cancelling a web repair stops the exact assistant thread it created", async () => {
  const controller = new AbortController();
  const calls = [];
  const cli = async (args) => {
    calls.push(args);
    if (args[1] === "start") return { threadId: "owned-repair" };
    if (args[1] === "show") {
      controller.abort();
      return { thread: { status: "running" }, messages: [] };
    }
    return { status: "interrupt_requested" };
  };
  await assert.rejects(runRepairThread(cli, ["thread", "start"], { signal: controller.signal }));
  assert.deepEqual(calls.at(-1), ["thread", "stop", "owned-repair", "--json"]);
});

test("a completed repair returns its answer without stopping other work", async () => {
  const calls = [];
  const result = await runRepairThread(
    async (args) => {
      calls.push(args);
      return args[1] === "start"
        ? { threadId: "owned-repair" }
        : {
            thread: { status: "completed" },
            messages: [{ role: "assistant", text: "Fixed" }],
          };
    },
    ["thread", "start"],
  );
  assert.equal(result.reply, "Fixed");
  assert.equal(calls.length, 2);
});
