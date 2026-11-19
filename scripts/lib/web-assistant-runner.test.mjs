import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebAssistant } from "./web-assistant-runner.mjs";

test("Qwen submits once through the focused composer and closes the background tab", async () => {
  const calls = [];
  let composerText = "Спросить Qwen";
  const result = await runWebAssistant(
    async (method, args) => {
      calls.push(method);
      if (method === "browser_open_tab") return "tab_id=17";
      assert.equal(args.tab_id, 17);
      if (method === "browser_snapshot") return `  [6] textarea "${composerText}"`;
      if (method === "browser_fill") {
        assert.equal(args.index, 6);
        composerText = args.text;
        return '  [7] button "Отправить"';
      }
      if (method === "browser_press_key") assert.equal(args.key, "Enter");
      if (method === "browser_read") return "MT_BEGIN_fixed\nГотово\nMT_END_fixed\n";
      return "";
    },
    { site: "qwen", input: "Ответь коротко", token: "fixed", wait: async () => {} },
  );
  assert.equal(result.answer, "Готово");
  assert.equal(calls.filter((method) => method === "browser_press_key").length, 1);
  assert.equal(calls.at(-1), "browser_close_tab");
});

test("an uncertain submit is reported without repeating it", async () => {
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
  assert.equal(result.status, "needs_help");
  assert.equal(result.submitMayHaveHappened, true);
  assert.equal(clicks, 1);
});
