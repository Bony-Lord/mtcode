import type { ModelBenchmarkSnapshot } from "./modelBenchmarks.ts";
import { BENCHMARK_SOURCES, DEFAULT_MODEL_BENCHMARKS, modelBenchmark } from "./modelBenchmarks.ts";

export function modelInsights(input: {
  slug: string;
  driver: string;
  instanceId: string;
  accountTier?: string | undefined;
  routingRole?: string | undefined;
  snapshot?: ModelBenchmarkSnapshot | undefined;
}) {
  const { slug, driver, instanceId, accountTier, routingRole } = input;
  if (slug.startsWith("mt-auto"))
    return {
      tags: ["Все провайдеры", "По задаче"],
      detail:
        "Авто выбирает конкретную модель перед запуском. При усложнении агент может передать задачу следующей модели.",
    };
  const local = accountTier === "local" || slug.startsWith("ollama-local/");
  const web = instanceId === "web-ai";
  const snapshot = input.snapshot ?? DEFAULT_MODEL_BENCHMARKS;
  const measured = modelBenchmark(slug, driver, snapshot);
  const tags = [
    local
      ? "Локальная"
      : web
        ? "Веб"
        : accountTier === "free"
          ? "Бесплатный доступ"
          : accountTier === "subscription" || driver === "codex"
            ? "Подписка"
            : "Облачная",
  ];
  if (routingRole === "assistant" || web) tags.push("Помощник");
  else tags.push("Агент");
  if (measured.coding) tags.push(`Код · TB ${measured.coding.score}%`);
  if (measured.intelligence) tags.push(`Рассуждения · AA ${measured.intelligence.score}`);
  if (driver === "codex" && slug === "gpt-6.1-terra") tags.push("Управление ПК", "Изображения");
  else if (/gemini|claude|gpt-[56]|vision|(?:^|[-_/])vl(?:[-_/]|$)/i.test(slug))
    tags.push("Изображения");
  if (!measured.coding && /coder|code|qwen|deepseek/i.test(slug)) tags.push("Профиль: код");
  const evidence = [
    measured.coding
      ? `Terminal-Bench ${snapshot.terminalVersion}: ${measured.coding.score}%, ${measured.coding.harness}, effort=${measured.coding.effort}. ${BENCHMARK_SOURCES.coding}`
      : "Сопоставимого результата Terminal-Bench для этой версии нет.",
    measured.intelligence
      ? `AA Intelligence Index: ${measured.intelligence.score}, лучший опубликованный режим. ${BENCHMARK_SOURCES.intelligence}`
      : "Сопоставимого AA Intelligence Index нет.",
    `Проверено ${snapshot.checkedAt.slice(0, 10)}. Результаты зависят от режима, инструментов и поставщика. «Профиль» означает предположение по семейству, а не измеренный балл.`,
    web ? "Веб-адаптер передаёт текст и код; интерфейс сайта открывается отдельно." : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { tags, detail: evidence };
}
