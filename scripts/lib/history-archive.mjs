import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeStreamPromises from "node:stream/promises";
import * as NodeZlib from "node:zlib";
import * as NodeURL from "node:url";

const hash = (value) => NodeCrypto.createHash("sha256").update(value).digest("hex");
const safeId = (value) => /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const words = (value) => value.toLowerCase().match(/[\p{L}\p{N}_./\\:-]{3,}/gu) ?? [];
const contentText = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((part) => ["text", "input_text", "output_text"].includes(part?.type))
          .map((part) => part.text ?? "")
          .join("\n")
      : "";
const longCompressor = () =>
  NodeZlib.createZstdCompress({
    params: {
      [NodeZlib.constants.ZSTD_c_compressionLevel]: 5,
      [NodeZlib.constants.ZSTD_c_windowLog]: 27,
      [NodeZlib.constants.ZSTD_c_enableLongDistanceMatching]: 1,
    },
  });
const longDecompressor = () =>
  NodeZlib.createZstdDecompress({ params: { [NodeZlib.constants.ZSTD_d_windowLogMax]: 27 } });

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await NodeFSP.writeFile(temporary, JSON.stringify(value));
  await NodeFSP.rename(temporary, file);
}

async function filesIn(directory) {
  const result = [];
  for (const entry of await NodeFSP.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const target = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesIn(target)));
    else if (entry.isFile() && /^rollout-.*\.jsonl(?:\.zst)?$/.test(entry.name))
      result.push(target);
  }
  return result;
}

function sourceStream(file) {
  const stream = NodeFS.createReadStream(file);
  return file.endsWith(".zst") ? stream.pipe(NodeZlib.createZstdDecompress()) : stream;
}

async function transcriptMetadata(file) {
  const lines = NodeReadline.createInterface({ input: sourceStream(file), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const record = JSON.parse(line);
      if (record.type === "session_meta" && safeId(record.payload?.id)) return record.payload;
    }
  } finally {
    lines.close();
    lines.input.destroy();
  }
  return null;
}

async function sha256File(file) {
  const digest = NodeCrypto.createHash("sha256");
  for await (const bytes of NodeFS.createReadStream(file)) digest.update(bytes);
  return digest.digest("hex");
}

export async function archiveCodexHistory({
  home = NodePath.join(NodeOS.homedir(), ".codex"),
  destination,
  chunkChars = 48_000,
}) {
  if (!destination) throw Error("Archive destination is required");
  await NodeFSP.mkdir(destination, { recursive: true });
  const indexPath = NodePath.join(destination, "index.json");
  const previous = JSON.parse(
    await NodeFSP.readFile(indexPath, "utf8").catch(() => '{"threads":[]}'),
  );
  const threads = new Map(previous.threads.map((thread) => [thread.id, thread]));
  const names = new Map();
  for (const line of (
    await NodeFSP.readFile(NodePath.join(home, "session_index.jsonl"), "utf8").catch(() => "")
  ).split("\n")) {
    try {
      const entry = JSON.parse(line);
      if (entry.id && entry.thread_name) names.set(entry.id, entry.thread_name);
    } catch {}
  }
  const sources = [
    ...(await filesIn(NodePath.join(home, "sessions"))),
    ...(await filesIn(NodePath.join(home, "archived_sessions"))),
  ];
  let updated = 0;
  let reused = 0;
  let sourceBytes = 0;
  let storedBytes = 0;
  let emptySources = 0;
  const failures = [];
  for (const file of sources) {
    try {
      const sourceStat = await NodeFSP.stat(file);
      sourceBytes += sourceStat.size;
      if (sourceStat.size === 0) {
        emptySources++;
        continue;
      }
      const metadata = await transcriptMetadata(file);
      if (!metadata) {
        failures.push({ file, reason: "missing-session-metadata" });
        continue;
      }
      const existing = threads.get(metadata.id);
      const fingerprint = `${file}\0${sourceStat.size}\0${sourceStat.mtimeMs}`;
      if (
        existing?.fingerprint === fingerprint ||
        existing?.variants?.some((variant) => variant.fingerprint === fingerprint)
      ) {
        reused++;
        continue;
      }
      const directory = NodePath.join(destination, metadata.id);
      await NodeFSP.mkdir(directory, { recursive: true });
      const sourceHash = await sha256File(file);
      const rawName = `source-${sourceHash.slice(0, 24)}.zst`;
      const rawFile = NodePath.join(directory, rawName);
      if (!(await NodeFSP.stat(rawFile).catch(() => null))) {
        const temporary = `${rawFile}.${process.pid}.tmp`;
        await NodeStreamPromises.pipeline(
          NodeFS.createReadStream(file),
          longCompressor(),
          NodeFS.createWriteStream(temporary, { flags: "wx" }),
        );
        const restored = NodeCrypto.createHash("sha256");
        for await (const bytes of NodeFS.createReadStream(temporary).pipe(longDecompressor()))
          restored.update(bytes);
        if (restored.digest("hex") !== sourceHash) throw Error("Archive checksum mismatch");
        await NodeFSP.rename(temporary, rawFile);
      }
      storedBytes += (await NodeFSP.stat(rawFile)).size;
      const variant = {
        source: file,
        sourceHash,
        raw: rawName,
        fingerprint,
        updatedAt: sourceStat.mtime.toISOString(),
      };
      const variants = [
        ...(existing?.variants ?? []).filter((entry) => entry.sourceHash !== sourceHash),
        variant,
      ];
      if (
        existing &&
        Date.parse(existing.updatedAt) > sourceStat.mtimeMs &&
        existing.source !== file
      ) {
        const retained = { ...existing, variants };
        threads.set(metadata.id, retained);
        await atomicJson(NodePath.join(directory, "manifest.json"), retained);
        updated++;
        continue;
      }
      const chunks = [];
      let pending = [];
      let pendingChars = 0;
      let ordinal = 0;
      let priorMessage = null;
      let firstUser = "";
      const recentRequests = [];
      const decisions = [];
      const flush = async () => {
        if (pending.length === 0) return;
        const text = pending
          .map((message) => `[${message.ordinal}] ${message.role} ${message.at}\n${message.text}`)
          .join("\n\n");
        const bytes = Buffer.from(JSON.stringify(pending));
        const name = `chunk-${String(chunks.length).padStart(5, "0")}-${hash(bytes).slice(0, 12)}.json.gz`;
        await NodeFSP.writeFile(NodePath.join(directory, name), NodeZlib.gzipSync(bytes));
        chunks.push({
          file: name,
          sha256: hash(bytes),
          first: pending[0].ordinal,
          last: pending.at(-1).ordinal,
          chars: text.length,
          terms: [...new Set(words(text))].slice(0, 2500),
        });
        pending = [];
        pendingChars = 0;
      };
      const lines = NodeReadline.createInterface({
        input: sourceStream(file),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        if (line.length > 32 * 1024 * 1024) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        let role;
        let text;
        if (record.type === "event_msg" && record.payload?.type === "user_message") {
          role = "user";
          text = record.payload.message;
        } else if (record.type === "response_item" && record.payload?.type === "message") {
          role = record.payload.role;
          text = contentText(record.payload.content);
        } else if (record.type === "event_msg" && record.payload?.type === "agent_message") {
          role = "assistant";
          text = record.payload.message;
        }
        if (!text?.trim() || !["user", "assistant"].includes(role)) continue;
        if (priorMessage?.role === role && priorMessage.text === text) continue;
        if (pendingChars >= chunkChars && role === "user") await flush();
        const message = { ordinal: ordinal++, role, text, at: record.timestamp ?? "" };
        pending.push(message);
        pendingChars += text.length;
        priorMessage = message;
        if (role === "user") {
          if (!firstUser) firstUser = text;
          recentRequests.push({ ordinal: message.ordinal, text: text.slice(0, 1600) });
          if (recentRequests.length > 12) recentRequests.shift();
        } else if (
          /провер|исправ|решени|следующ|не заверш|остал|TODO|verified|decision|next step|remaining/i.test(
            text,
          )
        ) {
          decisions.push({ ordinal: message.ordinal, text: text.slice(-2200) });
          if (decisions.length > 8) decisions.shift();
        }
        if (pendingChars >= chunkChars * 2) await flush();
      }
      await flush();
      const title =
        names.get(metadata.id) ??
        existing?.title ??
        firstUser
          .split("\n")
          .find((line) => line.trim() && !line.startsWith("<") && !line.startsWith("# AGENTS"))
          ?.slice(0, 120) ??
        metadata.id;
      const thread = {
        id: metadata.id,
        title,
        cwd: metadata.cwd ?? null,
        archived: file.includes(`${NodePath.sep}archived_sessions${NodePath.sep}`),
        fingerprint,
        source: file,
        sourceHash,
        raw: rawName,
        variants,
        sourceBytes: sourceStat.size,
        rawBytes: (await NodeFSP.stat(rawFile)).size,
        messageCount: ordinal,
        chunks,
        summary: {
          kind: "extractive",
          firstRequest: firstUser.slice(0, 1800),
          recentRequests,
          decisions,
        },
        updatedAt: sourceStat.mtime.toISOString(),
      };
      if (existing && existing.source !== file)
        thread.previousSources = [
          ...new Set([...(existing.previousSources ?? []), existing.source]),
        ];
      threads.set(thread.id, thread);
      updated++;
      await atomicJson(NodePath.join(directory, "manifest.json"), thread);
      await atomicJson(indexPath, { version: 1, threads: [...threads.values()] });
    } catch (error) {
      failures.push({ file, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  await atomicJson(indexPath, { version: 1, threads: [...threads.values()] });
  return {
    sources: sources.length,
    emptySources,
    threads: threads.size,
    updated,
    reused,
    sourceBytes,
    storedBytes,
    failures,
  };
}

/** Replaces only owned gzip snapshots, after round-trip verification and durable manifest updates. */
export async function compactHistory(destination) {
  const indexPath = NodePath.join(destination, "index.json");
  const index = JSON.parse(await NodeFSP.readFile(indexPath, "utf8"));
  let beforeBytes = 0,
    afterBytes = 0,
    converted = 0;
  for (const thread of index.threads) {
    if (!safeId(thread.id)) throw Error("Invalid archive thread id");
    const directory = NodePath.resolve(destination, thread.id);
    const names = new Map(
      [...(thread.variants ?? []), thread].map((entry) => [entry.raw, entry.sourceHash]),
    );
    for (const [oldName, sourceHash] of names) {
      if (!/^source-[a-f0-9]{24}\.gz$/.test(oldName)) continue;
      const oldFile = NodePath.join(directory, oldName);
      const previousBytes = (await NodeFSP.stat(oldFile)).size;
      const newName = oldName.replace(/\.gz$/, ".zst");
      const newFile = NodePath.join(directory, newName);
      const temporary = `${newFile}.${process.pid}.tmp`;
      await NodeStreamPromises.pipeline(
        NodeFS.createReadStream(oldFile),
        NodeZlib.createGunzip(),
        longCompressor(),
        NodeFS.createWriteStream(temporary, { flags: "wx" }),
      );
      const restored = NodeCrypto.createHash("sha256");
      for await (const bytes of NodeFS.createReadStream(temporary).pipe(longDecompressor()))
        restored.update(bytes);
      if (restored.digest("hex") !== sourceHash) throw Error("Compacted archive checksum mismatch");
      const nextBytes = (await NodeFSP.stat(temporary)).size;
      beforeBytes += previousBytes;
      if (nextBytes >= previousBytes) {
        afterBytes += previousBytes;
        await NodeFSP.unlink(temporary);
        continue;
      }
      await NodeFSP.rename(temporary, newFile);
      if (thread.raw === oldName) {
        thread.raw = newName;
        thread.rawBytes = nextBytes;
      }
      for (const variant of thread.variants ?? [])
        if (variant.raw === oldName) variant.raw = newName;
      await atomicJson(NodePath.join(directory, "manifest.json"), thread);
      await atomicJson(indexPath, index);
      // Both durable records now point at the verified replacement; the original Codex source is untouched.
      await NodeFSP.unlink(oldFile);
      afterBytes += nextBytes;
      converted++;
    }
  }
  return { converted, beforeBytes, afterBytes, savedBytes: beforeBytes - afterBytes };
}

export async function readHistoryChunk(destination, threadId, chunkIndex) {
  if (!safeId(threadId) || !Number.isSafeInteger(chunkIndex) || chunkIndex < 0)
    throw Error("Invalid history selection");
  const manifest = JSON.parse(
    await NodeFSP.readFile(NodePath.join(destination, threadId, "manifest.json"), "utf8"),
  );
  const chunk = manifest.chunks[chunkIndex];
  if (!chunk || NodePath.basename(chunk.file) !== chunk.file) throw Error("Unknown history chunk");
  const bytes = NodeZlib.gunzipSync(
    await NodeFSP.readFile(NodePath.join(destination, threadId, chunk.file)),
  );
  if (hash(bytes) !== chunk.sha256) throw Error("History chunk checksum mismatch");
  return { source: `${threadId}#${chunk.first}-${chunk.last}`, messages: JSON.parse(bytes) };
}

export async function searchHistory(destination, query, { limit = 5 } = {}) {
  const index = JSON.parse(
    await NodeFSP.readFile(NodePath.join(destination, "index.json"), "utf8"),
  );
  const terms = new Set(words(query));
  if (!terms.size) return [];
  return index.threads
    .flatMap((thread) =>
      thread.chunks.map((chunk, chunkIndex) => ({
        threadId: thread.id,
        title: thread.title,
        cwd: thread.cwd,
        archived: thread.archived,
        chunkIndex,
        first: chunk.first,
        last: chunk.last,
        score: chunk.terms.reduce((score, term) => score + Number(terms.has(term)), 0),
      })),
    )
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(20, limit));
}

export function historyPage(chunk, { maxChars = 64_000, messageIndex = 0, offset = 0 } = {}) {
  if (
    ![maxChars, messageIndex, offset].every(Number.isSafeInteger) ||
    maxChars < 1 ||
    messageIndex < 0 ||
    offset < 0
  )
    throw Error("Invalid history cursor");
  const messages = [];
  let chars = 0;
  let index = messageIndex;
  let start = offset;
  while (index < chunk.messages.length && chars < maxChars) {
    const message = chunk.messages[index];
    const text = message.text.slice(start, start + maxChars - chars);
    messages.push({ ...message, text, offset: start });
    chars += text.length;
    if (start + text.length < message.text.length) {
      start += text.length;
      break;
    }
    index++;
    start = 0;
  }
  const next = index < chunk.messages.length ? { messageIndex: index, offset: start } : null;
  return { source: chunk.source, messages, chars, next };
}

export async function historyMain(args) {
  const [command, ...rest] = args;
  const options = Object.fromEntries(
    rest
      .filter((_, index) => index % 2 === 0)
      .map((name, index) => [name.replace(/^--/, ""), rest[index * 2 + 1]]),
  );
  const destination =
    options.archive ?? NodePath.join(NodeOS.homedir(), "Documents", "MT Code History", "archive");
  if (command === "archive") return archiveCodexHistory({ home: options.home, destination });
  if (command === "compact") return compactHistory(destination);
  if (command === "search")
    return searchHistory(destination, options.query ?? "", { limit: Number(options.limit ?? 5) });
  if (command === "read") {
    const result = await readHistoryChunk(destination, options.thread, Number(options.chunk));
    const maxChars = Math.min(200_000, Math.max(1000, Number(options["max-chars"] ?? 64_000)));
    return historyPage(result, {
      maxChars,
      messageIndex: Number(options.message ?? 0),
      offset: Number(options.offset ?? 0),
    });
  }
  if (command === "status") {
    const index = JSON.parse(
      await NodeFSP.readFile(NodePath.join(destination, "index.json"), "utf8"),
    );
    return {
      threads: index.threads.length,
      messages: index.threads.reduce((sum, item) => sum + item.messageCount, 0),
    };
  }
  throw Error(
    "Use archive, compact, search, read or status. Options: --home PATH --archive PATH --query TEXT --thread ID --chunk N --max-chars N",
  );
}

if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  try {
    console.log(JSON.stringify(await historyMain(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
