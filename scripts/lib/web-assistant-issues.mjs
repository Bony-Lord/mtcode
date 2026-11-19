import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

function issueFile(root, site) {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(site)) throw Error("Некорректный веб-провайдер.");
  return NodePath.join(root, site, "issue.json");
}

export async function readWebIssue(root, site) {
  return NodeFSP.readFile(issueFile(root, site), "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
}

async function save(root, site, value) {
  const filename = issueFile(root, site);
  await NodeFSP.mkdir(NodePath.dirname(filename), { recursive: true });
  const temporary = filename + "." + NodeCrypto.randomUUID() + ".tmp";
  try {
    await NodeFSP.writeFile(temporary, JSON.stringify(value, null, 2));
    await NodeFSP.rename(temporary, filename);
  } finally {
    await NodeFSP.rm(temporary, { force: true });
  }
  return value;
}

export async function recordWebIssue(root, site, { reason, stage }) {
  const previous = await readWebIssue(root, site);
  const now = new Date().toISOString();
  return save(root, site, {
    status: "open",
    firstSeenAt: previous?.status === "open" ? previous.firstSeenAt : now,
    lastSeenAt: now,
    attempts: previous?.status === "open" ? previous.attempts + 1 : 1,
    stage,
    reason: String(reason ?? "Неожиданный результат").slice(0, 2400),
  });
}

export async function resolveWebIssue(root, site) {
  const previous = await readWebIssue(root, site);
  if (previous?.status !== "open") return;
  await save(root, site, { ...previous, status: "resolved", resolvedAt: new Date().toISOString() });
}
