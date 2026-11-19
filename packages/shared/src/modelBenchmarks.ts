import bundledSnapshot from "./modelBenchmarkSnapshot.json" with { type: "json" };

export interface ModelBenchmarkSnapshot {
  checkedAt: string;
  terminalVersion: string;
  coding: readonly { model: string; score: number; harness: string; effort: string }[];
  intelligence: readonly { model: string; score: number }[];
}
export const DEFAULT_MODEL_BENCHMARKS: ModelBenchmarkSnapshot = bundledSnapshot;

export const BENCHMARK_SOURCES = {
  coding: "https://www.tbench.ai/",
  intelligence: "https://artificialanalysis.ai/leaderboards/models",
};

export function benchmarkModelId(value: string) {
  const hadEffort = /\([^)]*\)/.test(value.replace(/\(openai\)$/, ""));
  const normalized = value
    .toLowerCase()
    .replace(/\(openai\)$/, "")
    .split("/")
    .at(-1)!
    .replace(/^(?:claude[- ]+)?(opus|sonnet|haiku|fable)[- ]+/, "claude-$1-")
    .replace(/\s*\([^)]*\).*$/, "")
    .replace(/\s+/g, "-")
    .replace(/^(claude-(?:opus|sonnet|haiku|fable)-\d+)-(\d+)$/, "$1.$2");
  return hadEffort || /^qwen[34](?:\.\d+)?-max$/.test(normalized)
    ? normalized
    : normalized.replace(/-(max|xhigh|high|medium|low)(?:,.*)?$/, "");
}

function tableRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) =>
      cell[1]!
        .replace(/<[^>]*>/g, " ")
        .replace(/&(?:amp|nbsp|#x27|quot|#39);/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ),
  );
}

export function parseBenchmarkPages(
  terminal: string,
  intelligence: string,
  checkedAt: string,
): ModelBenchmarkSnapshot {
  const terminalVersion = /TERMINAL-BENCH\s+(\d+\.\d+)/i.exec(
    terminal.replace(/<[^>]*>/g, " "),
  )?.[1];
  const coding = tableRows(terminal).flatMap((cells) => {
    if (!cells[1] || !cells[2]) return [];
    const score = /^(\d+(?:\.\d+)?)%\s*±/.exec(cells[3] ?? "");
    if (!score || Number(score[1]) > 100) return [];
    return [
      {
        model: benchmarkModelId(cells[1]),
        score: Number(score[1]),
        harness: cells[2],
        effort: /\(\s*([\w-]+)\s*\)/.exec(cells[1])?.[1] ?? "unknown",
      },
    ];
  });
  const scores = new Map<string, { model: string; score: number }>();
  for (const cells of tableRows(intelligence)) {
    if (!/^[\d.]+$/.test(cells[1] ?? "") || !cells[0]) continue;
    const model = benchmarkModelId(cells[0]),
      score = Number(cells[1]);
    if (score < 0 || score > 100) continue;
    // Multiple reasoning settings are separate rows. Keep the published best, and label it so.
    if ((scores.get(model)?.score ?? -1) < score) scores.set(model, { model, score });
  }
  if (!terminalVersion || coding.length < 5 || scores.size < 5)
    throw Error("Изменился формат таблицы бенчмарков. Сохранена предыдущая проверенная оценка.");
  return { checkedAt, terminalVersion, coding, intelligence: [...scores.values()] };
}

export function modelBenchmark(slug: string, driver: string, snapshot?: ModelBenchmarkSnapshot) {
  snapshot ??= DEFAULT_MODEL_BENCHMARKS;
  const id = benchmarkModelId(slug);
  const coding = snapshot?.coding.find((entry) => entry.model === id);
  const intelligence = snapshot?.intelligence.find((entry) => entry.model === id);
  const sameHarness =
    coding &&
    { codex: "Codex", antigravity: "Antigravity CLI", claudeAgent: "Claude Code" }[driver] ===
      coding.harness;
  return { coding, intelligence, sameHarness };
}
