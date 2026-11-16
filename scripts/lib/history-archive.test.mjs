import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";
import {
  archiveCodexHistory,
  historyPage,
  readHistoryChunk,
  searchHistory,
} from "./history-archive.mjs";

NodeTest.test(
  "archives all history losslessly, indexes older chunks and reuses unchanged data",
  async (t) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mt-history-test-"));
    t.after(async () => {
      NodeAssert.equal(NodePath.dirname(root), NodeOS.tmpdir());
      NodeAssert.ok(NodePath.basename(root).startsWith("mt-history-test-"));
      await NodeFSP.rm(root, { recursive: true, force: true });
    });
    const home = NodePath.join(root, "codex");
    const directory = NodePath.join(home, "archived_sessions");
    const destination = NodePath.join(root, "archive");
    await NodeFSP.mkdir(directory, { recursive: true });
    const source = NodePath.join(directory, "rollout-2020-01-01-chat-one.jsonl");
    const records = [
      JSON.stringify({ type: "session_meta", payload: { id: "chat-one", cwd: "/projects/app" } }),
    ];
    for (let index = 0; index < 500; index++)
      records.push(
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: index % 2 ? "assistant" : "user",
            content: [
              {
                type: "text",
                text: `message ${index}: ${index === 2 ? "unique-earlier-decision" : "context"} ${"detail ".repeat(30)}`,
              },
            ],
          },
        }),
      );
    const original = records.join("\n") + "\n";
    await NodeFSP.writeFile(source, original);
    const first = await archiveCodexHistory({ home, destination, chunkChars: 1200 });
    NodeAssert.equal(first.failures.length, 0);
    NodeAssert.equal(first.threads, 1);
    const manifest = JSON.parse(
      await NodeFSP.readFile(NodePath.join(destination, "chat-one", "manifest.json"), "utf8"),
    );
    NodeAssert.equal(manifest.messageCount, 500);
    NodeAssert.equal(
      NodeZlib.zstdDecompressSync(
        await NodeFSP.readFile(NodePath.join(destination, "chat-one", manifest.raw)),
      ).toString(),
      original,
    );
    NodeAssert.equal(await NodeFSP.readFile(source, "utf8"), original);
    NodeAssert.ok(manifest.chunks.length > 1);
    const hit = (await searchHistory(destination, "unique-earlier-decision"))[0];
    NodeAssert.ok(hit);
    const chunk = await readHistoryChunk(destination, hit.threadId, hit.chunkIndex);
    NodeAssert.ok(
      chunk.messages.some((message) => message.text.includes("unique-earlier-decision")),
    );
    const second = await archiveCodexHistory({ home, destination, chunkChars: 1200 });
    NodeAssert.equal(second.updated, 0);
    NodeAssert.equal(second.reused, 1);
    await NodeFSP.writeFile(
      source,
      original +
        JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "new request" },
        }) +
        "\n",
    );
    const third = await archiveCodexHistory({ home, destination });
    NodeAssert.equal(third.threads, 1);
    NodeAssert.equal(third.updated, 1);
    await NodeAssert.rejects(readHistoryChunk(destination, "../escape", 0));
  },
);

NodeTest.test("continues inside a very large message without dropping its tail", () => {
  const text = "x".repeat(200_001);
  const chunk = {
    source: "chat#0",
    messages: [
      { ordinal: 0, role: "user", text, at: "" },
      { ordinal: 1, role: "assistant", text: "done", at: "" },
    ],
  };
  let cursor = {};
  let restored = "";
  do {
    const page = historyPage(chunk, { ...cursor, maxChars: 16_000 });
    NodeAssert.ok(page.chars <= 16_000);
    restored += page.messages
      .filter((message) => message.ordinal === 0)
      .map((message) => message.text)
      .join("");
    cursor = page.next;
  } while (cursor);
  NodeAssert.equal(restored, text);
});
