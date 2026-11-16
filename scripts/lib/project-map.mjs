import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
const hash = (x) => NodeCrypto.createHash("sha256").update(x).digest("hex");
const excluded =
  /(^|\/)(node_modules|\.git|\.repos|dist|dist-electron|build|target|\.next|\.vite|\.cache|vendor|coverage|\.venv|venv|__pycache__)(\/|$)|(^|\/)(\.env[^/]*|credentials[^/]*|auth\.json|oauth[^/]*|.*\.lock|.*\.min\.[jt]s)$/i;
const source =
  /\.(?:[cm]?[jt]sx?|py|rs|java|kt|cs|cpp|cc|c|h|hpp|go|lua|gd|vue|svelte|md|toml|ya?ml)$/i;
function git(root, args) {
  const r = NodeChildProcess.spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  return r.status === 0 ? r.stdout.trim() : null;
}
async function walk(root, rel = "") {
  const out = [];
  for (const e of await NodeFSP.readdir(NodePath.join(root, rel), { withFileTypes: true })) {
    const name = rel ? `${rel}/${e.name}` : e.name;
    if (excluded.test(name) || e.isSymbolicLink()) continue;
    if (e.isDirectory()) out.push(...(await walk(root, name)));
    else if (e.isFile() && source.test(name)) out.push(name);
  }
  return out;
}
export function describeFile(file, text) {
  const symbols = [],
    imports = [],
    lines = text.split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    const m =
      /(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|def|struct|trait|fn|func|record)\s+([\w$]+)/.exec(
        line,
      ) ??
      /(?:export\s+)?(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/.exec(
        line,
      );
    if (m && symbols.length < 80) symbols.push({ name: m[1], line: i + 1 });
    if (/\.md$/i.test(file) && /^#{1,3}\s+/.test(line) && symbols.length < 80)
      symbols.push({ name: line.replace(/^#+\s*/, "").slice(0, 160), line: i + 1 });
    const dep =
      /\bfrom\s+["']([^"']+)["']|\brequire\(["']([^"']+)["']\)|^\s*(?:import|use|using)\s+([\w.:/]+)/.exec(
        line,
      );
    const name = dep && (dep[1] ?? dep[2] ?? dep[3]);
    if (name && imports.length < 60 && !imports.includes(name)) imports.push(name);
  }
  return { symbols, imports, lines: lines.length };
}
async function location(root, destination) {
  root = await NodeFSP.realpath(root);
  return {
    root,
    destination:
      destination ??
      NodePath.join(NodeOS.homedir(), ".mt", "project-maps", hash(root.toLowerCase()).slice(0, 20)),
  };
}
export async function updateMap(root, destination) {
  ({ root, destination } = await location(root, destination));
  await NodeFSP.mkdir(destination, { recursive: true });
  const prior = JSON.parse(
    await NodeFSP.readFile(NodePath.join(destination, "map.json"), "utf8").catch(
      () => '{"files":[]}',
    ),
  );
  if (prior.root && prior.root !== root) throw Error("Map belongs to another project");
  const old = new Map(prior.files.map((f) => [f.path, f]));
  const tracked = git(root, ["ls-files", "-co", "--exclude-standard", "-z"]);
  const names = [...new Set(tracked === null ? await walk(root) : tracked.split("\0"))]
    .filter((n) => n && source.test(n) && !excluded.test(n))
    .sort();
  const files = [],
    changes = [],
    skipped = [];
  let readFiles = 0;
  for (const name of names) {
    const absolute = NodePath.resolve(root, name);
    if (!absolute.startsWith(root + NodePath.sep)) continue;
    const info = await NodeFSP.stat(absolute).catch(() => null);
    if (!info?.isFile()) continue;
    if (
      info.size > 2 * 1024 * 1024 ||
      !(await NodeFSP.realpath(absolute)).startsWith(root + NodePath.sep)
    ) {
      skipped.push(name);
      continue;
    }
    const fingerprint = `${info.size}:${info.mtimeMs}`,
      previous = old.get(name);
    if (previous?.fingerprint === fingerprint) {
      files.push(previous);
      old.delete(name);
      continue;
    }
    const text = await NodeFSP.readFile(absolute, "utf8");
    readFiles++;
    const sha256 = hash(text);
    files.push({ path: name, fingerprint, sha256, ...describeFile(name, text) });
    if (previous?.sha256 !== sha256)
      changes.push({ path: name, kind: previous ? "modified" : "added" });
    old.delete(name);
  }
  for (const name of old.keys()) changes.push({ path: name, kind: "deleted" });
  const modules = {};
  for (const f of files) {
    const key = f.path.split("/").slice(0, 2).join("/");
    modules[key] = (modules[key] ?? 0) + 1;
  }
  const map = {
    version: 1,
    root,
    head: git(root, ["rev-parse", "HEAD"]),
    updatedAt: new Date().toISOString(),
    modules,
    files,
    changes,
    skipped,
  };
  await NodeFSP.writeFile(NodePath.join(destination, "map.json"), JSON.stringify(map));
  await NodeFSP.writeFile(
    NodePath.join(destination, "brief.json"),
    JSON.stringify(
      {
        ...map,
        files: files.length,
        changes: changes.slice(0, 100),
        moreChanges: Math.max(0, changes.length - 100),
      },
      null,
      2,
    ),
  );
  return {
    root,
    destination,
    indexedFiles: files.length,
    readFiles,
    reusedFiles: files.length - readFiles,
    changedFiles: changes.length,
    skippedFiles: skipped.length,
  };
}
export async function queryMap(root, query, { limit = 12, destination } = {}) {
  ({ root, destination } = await location(root, destination));
  const map = JSON.parse(await NodeFSP.readFile(NodePath.join(destination, "map.json"), "utf8"));
  const terms = query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  return map.files
    .map((f) => ({
      ...f,
      score: terms.reduce(
        (s, t) =>
          s +
          (f.path.toLowerCase().includes(t) ? 4 : 0) +
          f.symbols.reduce((n, x) => n + (x.name.toLowerCase().includes(t) ? 3 : 0), 0) +
          (f.imports.some((x) => x.toLowerCase().includes(t)) ? 1 : 0),
        0,
      ),
    }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(30, limit))
    .map(({ path: file, score, symbols, imports, lines }) => ({
      path: NodePath.join(root, file),
      score,
      symbols,
      imports,
      lines,
    }));
}
if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const o = Object.fromEntries(
      args.filter((_, i) => i % 2 === 0).map((k, i) => [k.replace(/^--/, ""), args[i * 2 + 1]]),
    );
    const root = o.root ?? process.cwd();
    if (command === "update") console.log(JSON.stringify(await updateMap(root, o.destination)));
    else if (command === "query")
      console.log(
        JSON.stringify(
          await queryMap(root, o.query ?? "", {
            destination: o.destination,
            limit: Number(o.limit ?? 12),
          }),
        ),
      );
    else throw Error("Use update --root PATH or query --root PATH --query TEXT");
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
