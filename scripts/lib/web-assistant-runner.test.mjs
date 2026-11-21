import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  normalizeWebAssistantAnswer,
  runWebAssistant,
  webConversationUrl,
} from "./web-assistant-runner.mjs";

NodeTest.test(
  "Qwen submits once through the focused composer and closes the background tab",
  async () => {
    const calls = [];
    let composerText = "Спросить Qwen";
    const result = await runWebAssistant(
      async (method, args) => {
        calls.push(method);
        if (method === "browser_open_tab") return "tab_id=17";
        NodeAssert.equal(args.tab_id, 17);
        if (method === "browser_snapshot") return `  [6] textarea "${composerText}"`;
        if (method === "browser_fill") {
          NodeAssert.equal(args.index, 6);
          composerText = args.text;
          return '  [7] button "Отправить"';
        }
        if (method === "browser_press_key") NodeAssert.equal(args.key, "Enter");
        if (method === "browser_read") return "MT_BEGIN_fixed\nГотово\nMT_END_fixed\n";
        return "";
      },
      { site: "qwen", input: "Ответь коротко", token: "fixed", wait: async () => {} },
    );
    NodeAssert.equal(result.answer, "Готово");
    NodeAssert.equal(calls.filter((method) => method === "browser_press_key").length, 1);
    NodeAssert.equal(calls.at(-1), "browser_close_tab");
  },
);

NodeTest.test("an uncertain submit is reported without repeating it", async () => {
  let clicks = 0;
  const result = await runWebAssistant(
    async (method) => {
      if (method === "browser_open_tab") return "tab_id=23";
      if (method === "browser_snapshot") return '  [6] div[editable] "Спросить ChatGPT"';
      if (method === "browser_fill") return '  [8] button "Отправить запрос"';
      if (method === "browser_click") {
        clicks++;
        throw Error("Timed out after send");
      }
      return "";
    },
    { site: "chatgpt", input: "Ответь коротко" },
  );
  NodeAssert.equal(result.status, "needs_help");
  NodeAssert.equal(result.submitMayHaveHappened, true);
  NodeAssert.equal(clicks, 1);
});

NodeTest.test("uploads only selected files and waits for send to become available", async () => {
  const paths = ["C:\\temp\\01-requirements.txt", "C:\\temp\\02-board.png"];
  const calls = [];
  let prepared = false;
  const result = await runWebAssistant(
    async (method, args) => {
      calls.push(method);
      if (method === "browser_open_tab") return "tab_id=27";
      if (method === "browser_snapshot")
        return [
          "[https://chatgpt.com/c/test-thread]",
          '[2] div[editable] "Ask anything"',
          "[3] input[file] multiple",
          ...(prepared ? ['[8] button "Send prompt"'] : []),
        ].join("\n");
      if (method === "browser_upload_file") {
        NodeAssert.equal(args.index, 3);
        NodeAssert.deepEqual(args.paths, paths);
        return "attached";
      }
      if (method === "browser_fill") {
        NodeAssert.match(args.text, /attached the MT Code output skill/);
        NodeAssert.match(args.text, /keyboard-operable/);
        NodeAssert.ok(!paths.some((path) => args.text.includes(path)));
        prepared = true;
        return '[8] button "Send prompt" [disabled]';
      }
      if (method === "browser_click") NodeAssert.equal(args.index, 8);
      if (method === "browser_read")
        return "Chat [https://chatgpt.com/c/test-thread?tracking=1]\nMT_BEGIN_fixed\nDone\nMT_END_fixed\n";
      return "";
    },
    {
      site: "chatgpt",
      input: "$mt-code-output Show results",
      attachments: paths,
      token: "fixed",
      wait: async () => {},
    },
  );
  NodeAssert.equal(result.status, "completed");
  NodeAssert.equal(result.conversationUrl, "https://chatgpt.com/c/test-thread");
  NodeAssert.ok(calls.indexOf("browser_upload_file") < calls.indexOf("browser_fill"));
  NodeAssert.ok(
    calls
      .slice(calls.indexOf("browser_fill") + 1, calls.indexOf("browser_click"))
      .includes("browser_snapshot"),
  );
});

NodeTest.test("refuses attachment transfer after a cross-site redirect", async () => {
  const calls = [];
  const result = await runWebAssistant(
    async (method) => {
      calls.push(method);
      if (method === "browser_open_tab") return "tab_id=28";
      return '[https://example.test]\n[1] textarea "Ask anything"\n[2] input[file]';
    },
    { site: "chatgpt", input: "Review", attachments: ["C:\\temp\\document.txt"] },
  );
  NodeAssert.equal(result.stage, "attachments");
  NodeAssert.equal(result.attachmentTransferMayHaveStarted, false);
  NodeAssert.ok(!calls.includes("browser_upload_file"));
  NodeAssert.ok(!calls.includes("browser_click"));
});

NodeTest.test(
  "allows only an actual same-site conversation to be reused and repairs a bare widget",
  () => {
    const fence = String.fromCharCode(96).repeat(3);
    NodeAssert.equal(webConversationUrl("chatgpt", "https://chatgpt.com/settings"), undefined);
    NodeAssert.equal(webConversationUrl("chatgpt", "https://example.test/c/123"), undefined);
    NodeAssert.equal(
      normalizeWebAssistantAnswer("Summary\n\nmt-html\n<html><body>Widget</body></html>\nNotes"),
      "Summary\n\n" + fence + "mt-html\n<html><body>Widget</body></html>\n" + fence + "\nNotes",
    );
  },
);
