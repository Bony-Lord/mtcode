import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { readWebIssue, recordWebIssue, resolveWebIssue } from "./web-assistant-issues.mjs";

test("an unresolved web issue survives restart and clears only after a successful attempt", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mt-web-issue-"));
  try {
    await recordWebIssue(root, "qwen", { reason: "Missing composer", stage: "composer" });
    const first = await readWebIssue(root, "qwen");
    assert.equal(first.status, "open");
    await recordWebIssue(root, "qwen", { reason: "Still missing", stage: "composer" });
    const pending = await readWebIssue(root, "qwen");
    assert.equal(pending.firstSeenAt, first.firstSeenAt);
    assert.equal(pending.attempts, 2);
    await resolveWebIssue(root, "qwen");
    assert.equal((await readWebIssue(root, "qwen")).status, "resolved");
    assert.equal(await readWebIssue(root, "gemini"), null);
    await assert.rejects(recordWebIssue(root, "../escape", { reason: "test" }));
    assert.deepEqual(await fs.readdir(root), ["qwen"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
