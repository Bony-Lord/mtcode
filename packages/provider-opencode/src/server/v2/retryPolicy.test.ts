import { expect, it } from "vite-plus/test";
import { retryDecision } from "./retryPolicy.ts";

it("stops invalid prompts immediately and bounds retryable upstream failures", () => {
  for (const message of [
    "[429]: ERR_INPUT_LIMIT",
    "maximum context length exceeded",
    "too many input tokens",
  ])
    expect(retryDecision(2, message)).toBe("invalid-input");
  expect(retryDecision(2, "429 requests per minute exceeded")).toBe("retry");
  expect(retryDecision(3, "503 upstream unavailable")).toBe("retry");
  expect(retryDecision(4, "503 upstream unavailable")).toBe("exhausted");
});

it("stops at a spent quota or rate limit instead of requesting again", () => {
  for (const attempt of [2, 3, 4]) {
    expect(retryDecision(attempt, "429 quota exceeded", { usageLimit: true })).toBe("usage-limit");
  }
  // An invalid prompt stays terminal even when the provider also reports a limit.
  expect(retryDecision(2, "maximum context length exceeded", { usageLimit: true })).toBe(
    "invalid-input",
  );
});
