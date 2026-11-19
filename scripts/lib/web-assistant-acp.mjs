import * as NodeCrypto from "node:crypto";
import * as NodeReadline from "node:readline";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { runConfiguredWebAssistant, sites } from "./web-assistant-runner.mjs";
import { repairWebAssistant } from "./web-assistant-repair.mjs";
import { delegate } from "./economical-router.mjs";
import { readWebIssue, recordWebIssue, resolveWebIssue } from "./web-assistant-issues.mjs";

const plainGateway = process.env.MT_CHAT_PROVIDER === "omniroute";
const gatewayConfigPath = NodePath.join(
  NodeOS.homedir(),
  ".mt",
  "tools",
  "workspace",
  "opencode-omniroute.json",
);
const definitions = plainGateway
  ? Object.fromEntries(
      Object.entries(
        JSON.parse(await NodeFSP.readFile(gatewayConfigPath, "utf8")).provider.omniroute.models,
      ).map(([id, model]) => [`omniroute/${id}`, { name: model.name ?? id }]),
    )
  : sites;
const models = Object.entries(definitions).map(([modelId, site]) => ({ modelId, name: site.name }));
const sessions = new Map();
const write = (frame) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...frame }) + "\n");

function userMessage(block) {
  const text = block?.type === "text" && typeof block.text === "string" ? block.text : "";
  const request =
    /^<t3_code_instructions>[\s\S]*?<\/t3_code_instructions>\s*<user_request>\n([\s\S]*?)\n<\/user_request>$/.exec(
      text,
    )?.[1] ?? text;
  return request.replace(/^\s*<mt_work_profile\b[^>]*>[\s\S]*?<\/mt_work_profile>\s*/i, "");
}

const sessionsRoot = NodePath.join(
  NodeOS.homedir(),
  ".mt",
  "tools",
  "workspace",
  "web-ai",
  "sessions",
);
const issuesRoot = NodePath.dirname(sessionsRoot);
const notify = (sessionId, text) =>
  write({
    method: "session/update",
    params: {
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  });
async function saveSession(sessionId, session) {
  await NodeFSP.mkdir(sessionsRoot, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(sessionsRoot, sessionId + ".json"),
    JSON.stringify({
      site: session.site,
      previous: session.previous,
      cwd: session.cwd,
      conversationUrl: session.conversationUrl,
    }),
  );
}

async function dispatch({ method, params = {} }) {
  if (method === "initialize") {
    return {
      protocolVersion: 1,
      agentInfo: { name: "mt-web-ai", version: "1" },
      agentCapabilities: { loadSession: true },
      authMethods: [],
    };
  }
  if (method === "session/new") {
    const sessionId = NodeCrypto.randomUUID();
    const currentModelId = plainGateway
      ? models[0].modelId
      : (process.env.MT_WEB_AI_DEFAULT ?? "gemini");
    sessions.set(sessionId, { site: currentModelId, previous: "", cwd: params.cwd, active: null });
    await saveSession(sessionId, sessions.get(sessionId));
    return { sessionId, models: { currentModelId, availableModels: models } };
  }
  const { sessionId } = params;
  if (method === "session/load") {
    if (!/^[\da-f-]{36}$/.test(sessionId)) throw Error("Некорректный ID веб-чата.");
    const saved = JSON.parse(
      await NodeFSP.readFile(NodePath.join(sessionsRoot, sessionId + ".json"), "utf8"),
    );
    if (!Object.hasOwn(definitions, saved.site)) throw Error("Модель чата недоступна.");
    sessions.set(sessionId, { ...saved, cwd: params.cwd ?? saved.cwd, active: null });
    return { models: { currentModelId: saved.site, availableModels: models } };
  }
  const session = sessions.get(sessionId);
  if (!session) throw Error("Веб-сессия недоступна. Открой новый веб-чат.");
  if (method === "session/set_model") {
    if (session.active || !Object.hasOwn(definitions, params.modelId))
      throw Error("Веб-модель недоступна.");
    if (session.site !== params.modelId) {
      session.previous = "";
      session.conversationUrl = undefined;
    }
    session.site = params.modelId;
    await saveSession(sessionId, session);
    return {};
  }
  if (method === "session/cancel") {
    session.active?.abort();
    return {};
  }
  if (method !== "session/prompt") throw Error(`Метод ACP недоступен: ${method}`);
  if (session.active) throw Error("Предыдущий веб-запрос ещё выполняется.");
  const text = userMessage(params.prompt?.[0]);
  if (!text.trim()) throw Error("Веб-чат принимает текстовый запрос.");
  const controller = new AbortController();
  session.active = controller;
  try {
    const pendingIssue = plainGateway ? null : await readWebIssue(issuesRoot, session.site);
    if (pendingIssue?.status === "open") {
      notify(
        sessionId,
        `Напоминание: проблема ${definitions[session.site].name} ещё не подтверждена как исправленная. ${pendingIssue.reason}\n\n`,
      );
    }
    const requestRepair = /^\s*@ass?istant\b/i.test(text);
    if (requestRepair && !plainGateway) {
      await recordWebIssue(issuesRoot, session.site, { stage: "reported", reason: text });
      notify(sessionId, "Помощник проверяет адаптер и результат веб-чата…\n\n");
      const repaired = await repairWebAssistant({
        site: session.site,
        cwd: session.cwd,
        report: text,
        signal: controller.signal,
      });
      notify(sessionId, repaired.reply || "Проверка помощника завершена.");
      return { stopReason: "end_turn" };
    }
    const input =
      !session.conversationUrl && session.previous && text.length + session.previous.length < 23_000
        ? `${session.previous}\n\nТекущий запрос:\n${text}`
        : text;
    const result = plainGateway
      ? await delegate(
          { domain: "draft", input, route: `configured/${session.site}` },
          (url, options) =>
            fetch(url, {
              ...options,
              signal: AbortSignal.any([controller.signal, options.signal]),
            }),
        ).then(
          (reply) => ({ status: "completed", answer: reply.text }),
          (error) => ({ status: "needs_help", stage: "provider", reason: error.message }),
        )
      : await runConfiguredWebAssistant(session.site, input, {
          signal: controller.signal,
          conversationUrl: session.conversationUrl,
        }).catch((error) => ({ status: "needs_help", stage: "setup", reason: error.message }));
    const diagnosticRoot = NodePath.join(
      NodeOS.homedir(),
      ".mt",
      "tools",
      "workspace",
      "web-ai",
      plainGateway
        ? `gateway-${NodeCrypto.createHash("sha256").update(session.site).digest("hex").slice(0, 20)}`
        : session.site,
    );
    await NodeFSP.mkdir(diagnosticRoot, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(diagnosticRoot, "last-result.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          site: session.site,
          status: result.status,
          stage: result.stage,
          reason: result.reason,
          evidence: result.evidence,
          submitMayHaveHappened: result.submitMayHaveHappened,
          inputChars: input.length,
          userRequest: text.slice(-6000),
          answer: result.answer?.slice(0, 6000),
        },
        null,
        2,
      ),
    );
    if (controller.signal.aborted) return { stopReason: "cancelled" };
    const answer =
      result.status === "completed"
        ? result.answer
        : `Чат ${definitions[session.site].name} остановился на этапе ${result.stage}. ${result.reason}${result.submitMayHaveHappened ? " Запрос мог быть отправлен. Проверь чат на сайте перед повтором." : ""}`;
    notify(sessionId, answer);
    if (result.status === "completed") {
      if (!plainGateway) await resolveWebIssue(issuesRoot, session.site);
      session.conversationUrl = result.conversationUrl;
      session.previous = `Последний запрос: ${text.slice(-3500)}\nПоследний ответ: ${answer.slice(-3500)}`;
      await saveSession(sessionId, session);
    } else if (!plainGateway && !controller.signal.aborted) {
      await recordWebIssue(issuesRoot, session.site, result);
      if (result.stage === "challenge") {
        notify(
          sessionId,
          "\n\nПрепятствие сохранено. Заверши вход или CAPTCHA на сайте; при следующем использовании я напомню о нерешённой проблеме.",
        );
        return { stopReason: "end_turn" };
      }
      const lastRepairPath = NodePath.join(diagnosticRoot, "last-auto-repair.json");
      const lastRepair = await NodeFSP.readFile(lastRepairPath, "utf8").then(JSON.parse, () => ({
        at: 0,
      }));
      if (Date.now() - lastRepair.at >= 600_000) {
        await NodeFSP.writeFile(lastRepairPath, JSON.stringify({ at: Date.now() }));
        notify(sessionId, "\n\nПередаю диагностику выбранному помощнику…\n\n");
        const repair = await repairWebAssistant({
          site: session.site,
          cwd: session.cwd,
          signal: controller.signal,
        });
        notify(sessionId, repair.reply || "Помощник завершил проверку адаптера.");
      } else {
        notify(
          sessionId,
          "\n\nДиагностика сохранена. Для повторной проверки отправь @assistant с описанием проблемы.",
        );
      }
    }
    return { stopReason: "end_turn" };
  } catch (error) {
    if (controller.signal.aborted) return { stopReason: "cancelled" };
    throw error;
  } finally {
    session.active = null;
  }
}

const input = NodeReadline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return;
  }
  if (!frame || typeof frame.method !== "string") return;
  void dispatch(frame).then(
    (result) => {
      if (frame.id !== undefined) write({ id: frame.id, result });
    },
    (error) => {
      if (frame.id !== undefined)
        write({ id: frame.id, error: { code: -32603, message: error.message } });
    },
  );
});
input.on("close", () => {
  for (const session of sessions.values()) session.active?.abort();
});
