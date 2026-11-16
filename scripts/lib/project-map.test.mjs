import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { updateMap, queryMap } from "./project-map.mjs";
NodeTest.test("reuses unchanged files, tracks deltas and finds symbols", async (t) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mt-project-map-test-"));
  t.after(async () => {
    NodeAssert.ok(root.startsWith(NodePath.join(NodeOS.tmpdir(), "mt-project-map-test-")));
    await NodeFSP.rm(root, { recursive: true, force: true });
  });
  await NodeFSP.mkdir(NodePath.join(root, "src"));
  await NodeFSP.mkdir(NodePath.join(root, "node_modules"));
  await NodeFSP.writeFile(
    NodePath.join(root, "src/auth.ts"),
    'import {Session} from "./session";\nexport function refreshSession() {}\n',
  );
  await NodeFSP.writeFile(NodePath.join(root, "node_modules/skip.ts"), "function forbidden(){}");
  await NodeFSP.writeFile(NodePath.join(root, ".env"), "SECRET=preserve");
  const destination = NodePath.join(root, "map-cache");
  NodeAssert.equal((await updateMap(root, destination)).readFiles, 1);
  const second = await updateMap(root, destination);
  NodeAssert.equal(second.readFiles, 0);
  NodeAssert.equal(second.changedFiles, 0);
  NodeAssert.equal((await queryMap(root, "refreshSession", { destination }))[0].symbols[0].line, 2);
  await NodeFSP.writeFile(
    NodePath.join(root, "src/auth.ts"),
    "export function renewSession() {}\n",
  );
  const third = await updateMap(root, destination);
  NodeAssert.equal(third.readFiles, 1);
  NodeAssert.equal(third.changedFiles, 1);
});
