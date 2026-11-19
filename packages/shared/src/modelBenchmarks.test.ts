import { expect, it } from "vite-plus/test";
import { benchmarkModelId, modelBenchmark, parseBenchmarkPages } from "./modelBenchmarks.ts";
import { modelInsights } from "./modelInsights.ts";

it("matches exact model versions and does not assign a sibling's benchmark", () => {
  expect(benchmarkModelId("GPT-6.1 Sol ( max )")).toBe("gpt-6.1-sol");
  expect(benchmarkModelId("Claude Opus 5.5 Max, Default Fallback")).toBe("claude-opus-5.5");
  expect(benchmarkModelId("Qwen3.8-Max-0902 (max)")).toBe("qwen3.8-max-0902");
  expect(benchmarkModelId("Qwen4 Max")).toBe("qwen4-max");
  expect(modelBenchmark("ovh-free/Qwen3.6-27B", "opencode").intelligence).toBeUndefined();
  expect(modelBenchmark("opencode/glm-5.3", "opencode").sameHarness).toBe(false);
});

it("rejects broken or unrelated remote tables rather than publishing invented rankings", () => {
  expect(() =>
    parseBenchmarkPages("<html>down</html>", "<html>down</html>", "2026-11-17"),
  ).toThrow();
});

it("distinguishes local deployment, free access and unknown model strengths", () => {
  const local = modelInsights({
    slug: "ollama-local/qwen3.5:4b",
    driver: "opencode",
    instanceId: "opencode-free",
    accountTier: "free",
  });
  expect(local.tags).toContain("Локальная");
  expect(local.detail).toContain("результата Terminal-Bench");
  const auto = modelInsights({ slug: "mt-auto", driver: "codex", instanceId: "codex" });
  expect(auto.tags).toContain("Все провайдеры");
  expect(auto.tags).not.toContain("Подписка");
});
