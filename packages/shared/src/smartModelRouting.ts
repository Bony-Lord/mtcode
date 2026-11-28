import {
  type ModelSelection,
  type ProjectId,
  type ServerProvider,
  type ServerSettings,
  resolveProjectProviderInstanceEnabled,
} from "@t3tools/contracts";
import {
  exhaustedAccountUsageWindow,
  accountUsageBudgetBlock,
  providerUsageDisplaySource,
  usageWindowApplies,
} from "./usageLimits.ts";
import { resolveAgentWorkModes } from "./agentWorkProfiles.ts";
import { BENCHMARK_SOURCES, DEFAULT_MODEL_BENCHMARKS, modelBenchmark } from "./modelBenchmarks.ts";
import { modelFamily } from "./model.ts";
import type { AutoRouteFailureReason } from "./orchestrationV2ThreadError.ts";

// Terminal-Bench 4.0, Codex harness, max effort. Snapshot of the public
// leaderboard on 2026-11-17. Scores are a tie-break for code, not a generic rank.
const TERRA_OSWORLD_SOURCE = "https://openai.com/index/introducing-gpt-6-1-terra/";

/** App routing is distinct from a provider's native model named `auto`. */
export const SMART_MODEL = "mt-auto";
export const SMART_MODEL_MODES = [
  SMART_MODEL,
  "mt-auto/fast",
  "mt-auto/economy",
  "mt-auto/quality",
  "mt-auto/subscription",
] as const;
export const isSmartModel = (model: string) => SMART_MODEL_MODES.some((mode) => mode === model);
export const isTrivialRoutingTask = (text: string) =>
  text.length < 120 &&
  /^(?:(?:привет|спасибо|здравствуй|hi|hello|thanks)[!.\s]*|(?:(?:сколько будет|посчитай|вычисли|what is)\s+)?[\d\s+*/().,^=−–-]+[?!.\s]*)$/i.test(
    text.trim(),
  );

export function routingTask(text: string, images: boolean) {
  if (images) return "vision";
  if (/управля\S*\s+(?:пк|компьютер)|computer.use|нажми|мышк|click.*(?:window|button)/i.test(text))
    return "computer";
  if (
    /архитектур|доказатель|сложн|глубок\S* анализ|расслед|reason carefully|architecture|prove|root cause/i.test(
      text,
    ) ||
    text.length > 12_000
  )
    return "reasoning";
  if (
    /код|баг|ошибк|исправ|репозит|рефактор|тест|установ|скачай|создай\S*\s+файл|папк|перцептрон|нейросет\S*\s+на|(?:сделай|создай|разработай|напиши)\s+(?:\S+\s+){0,3}(?:приложени|программ|сайт|игр)|code|bug|refactor|implement|debug|install|download|typescript|python|C\+\+|C#|\bSQL\b|```/i.test(
      text,
    )
  )
    return "code";
  return "quick";
}

export function routingTaskText(text: string, previousUserTasks: readonly string[]): string {
  if (
    !/^(?:продолжай|продолжить|дальше|итоговый|доделай|готово|continue|resume|finish|go on)[.!\s]*$/i.test(
      text.trim(),
    )
  )
    return text;
  const task = previousUserTasks.findLast(
    (entry) => entry.trim() !== text.trim() && routingTask(entry, false) !== "quick",
  );
  return task ? `${task.slice(-7000)}\n\nТекущее уточнение: ${text}` : text;
}

export interface RoutingObservation {
  readonly instanceId: string;
  readonly model: string;
  readonly failed?: boolean;
  readonly blocked?: boolean;
  readonly blockedReason?: AutoRouteFailureReason;
  readonly latencyMs?: number;
}

/** Explicit, inspectable heuristics; these priorities are not model benchmark scores. */
export function selectSmartModel(input: {
  readonly requested: ModelSelection;
  readonly providers: readonly ServerProvider[];
  readonly settings: ServerSettings;
  readonly projectId: ProjectId;
  readonly text: string;
  readonly images?: boolean | undefined;
  readonly now: number;
  readonly previous?: ModelSelection | undefined;
  readonly observations?: readonly RoutingObservation[];
  readonly escalate?: boolean;
  readonly excludedModels?: readonly string[];
  readonly excludedSelections?: readonly ModelSelection[];
  readonly advice?:
    | {
        readonly task: ReturnType<typeof routingTask>;
        readonly complexity: "simple" | "medium" | "complex";
        readonly preferredSelection?: ModelSelection | undefined;
        readonly reason: string;
      }
    | undefined;
}): { selection: ModelSelection; reason: string; alternatives: number } | null {
  const modes = resolveAgentWorkModes(input.settings, input.projectId);
  const trivial = isTrivialRoutingTask(input.text) && !input.images;
  const thinking = modes.includes("thinking");
  const deliberate = thinking || modes.includes("research");
  const fast =
    !input.escalate && (modes.includes("fast") || input.requested.model === "mt-auto/fast");
  const economy =
    !input.escalate && (modes.includes("economy") || input.requested.model === "mt-auto/economy");
  const localTask = routingTask(input.text, input.images === true);
  const detectedTask = localTask === "quick" && input.advice ? input.advice.task : localTask;
  const substantialCode =
    detectedTask === "code" &&
    /приложени|гиперпараметр|визуализац|репозит|проект|архитектур|разработ|рефактор|application|repository|project|refactor/i.test(
      input.text,
    );
  const quality =
    input.escalate === true ||
    (!trivial && deliberate) ||
    detectedTask === "reasoning" ||
    input.advice?.complexity === "complex" ||
    substantialCode ||
    input.requested.model === "mt-auto/quality";
  const benchmarkSnapshot = input.settings.modelBenchmarkSnapshot ?? DEFAULT_MODEL_BENCHMARKS;
  const task = !trivial && deliberate && detectedTask === "quick" ? "reasoning" : detectedTask;
  const previousFamily = input.previous ? modelFamily(input.previous.model) : undefined;
  const candidates = input.providers
    .flatMap((provider) => {
      const config = input.settings.providerInstances[provider.instanceId];
      const tier = config?.accountTier;
      if (config?.routingRole === "excluded" || config?.routingRole === "assistant") return [];
      if (
        !provider.enabled ||
        !provider.installed ||
        provider.status !== "ready" ||
        provider.auth.status !== "authenticated" ||
        config?.freeAccountPaused ||
        !resolveProjectProviderInstanceEnabled(
          input.settings,
          input.projectId,
          provider.instanceId,
        ) ||
        tier === "paid-api" ||
        (tier !== "free" &&
          tier !== "local" &&
          tier !== "subscription" &&
          !(provider.driver === "codex" && provider.auth.type === "chatgpt") &&
          provider.driver !== "antigravity") ||
        (input.requested.model === "mt-auto/subscription" && tier !== "subscription")
      )
        return [];
      const usageWindows =
        providerUsageDisplaySource(provider, input.providers)?.usageLimits?.windows ?? [];
      return provider.models.flatMap((model) => {
        if (
          input.excludedModels?.includes(model.slug) ||
          input.excludedSelections?.some(
            (selection) =>
              selection.instanceId === provider.instanceId && selection.model === model.slug,
          ) ||
          (input.escalate &&
            input.previous?.instanceId === provider.instanceId &&
            input.previous.model === model.slug)
        )
          return [];
        const slug = model.slug.toLowerCase();
        if (
          isSmartModel(slug) ||
          /^(auto|default|antigravity-default)$/.test(slug) ||
          model.isLegacy ||
          accountUsageBudgetBlock(
            provider,
            input.providers,
            input.settings,
            input.now,
            model.slug,
          ) ||
          exhaustedAccountUsageWindow(provider, input.providers, input.now, model.slug)
        )
          return [];
        const recent =
          input.observations?.filter(
            (observation) =>
              observation.instanceId === provider.instanceId && observation.model === model.slug,
          ) ?? [];
        const providerRecentlyBlocked =
          input.observations?.some(
            (observation) =>
              observation.instanceId === provider.instanceId &&
              observation.blocked &&
              (observation.blockedReason === "sharing_forbidden" ||
                observation.blockedReason === "usage_limit" ||
                observation.blockedReason === "free_limit"),
          ) ?? false;
        if (providerRecentlyBlocked || recent.some((observation) => observation.blocked)) return [];
        const multimodal = /vl|vision|gemma-?3|gemma3|qwen3\.[56]|gemini|gpt-[56]|claude/.test(
          slug,
        );
        if (task === "vision" && !multimodal) return [];
        if (task === "computer" && provider.driver !== "codex" && provider.driver !== "antigravity")
          return [];
        const local = tier === "local" || /ollama/.test(slug);
        const free = tier === "free" || local;
        const small = /(?:^|[/:_-])(?:[1-9]|1\d|20)b\b|luna|haiku|flash|mini|small|lightning/.test(
          slug,
        );
        const strong = /astra|opus|pro\b|120b|397b|deepseek|glm|kimi|big-pickle|sol|terra/.test(
          slug,
        );
        let priority = task === "quick" ? (small ? 60 : 25) : strong ? 65 : small ? 20 : 45;
        if (task === "code" && /codex|terra|sol|coder|qwen|deepseek|big-pickle/.test(slug))
          priority += 20;
        if (task === "reasoning" && /astra|opus|pro\b|120b|397b/.test(slug)) priority += 20;
        if (task === "vision" && multimodal) priority += 20;
        const benchmark = modelBenchmark(slug, provider.driver, benchmarkSnapshot);
        const codeScore = task === "code" ? benchmark.coding?.score : undefined;
        // A model evaluated in a different agent is useful evidence, with lower confidence.
        // Unknown models keep a neutral prior; their names never become benchmark scores.
        const measured =
          task === "code"
            ? codeScore
            : task === "reasoning"
              ? benchmark.intelligence?.score
              : undefined;
        if (measured !== undefined)
          priority = 40 + measured * 0.8 - (task === "code" && !benchmark.sameHarness ? 8 : 0);
        const testedComputerUse =
          task === "computer" && provider.driver === "codex" && slug === "gpt-6.1-terra";
        if (testedComputerUse) priority += 22;
        if (!quality && free) priority += task === "code" ? 28 : 20;
        if (local && task !== "quick" && measured === undefined) priority -= 15;
        if (fast) priority += quality ? (small && strong ? 8 : 0) : small ? 35 : -15;
        if (economy) priority += quality ? (free && strong ? 25 : 0) : free ? 35 : -15;
        if (input.escalate && previousFamily && modelFamily(model.slug) === previousFamily)
          priority += 8;
        const measuredWindows = usageWindows.filter(
          (window) => window.observedUntil === undefined && usageWindowApplies(window, model.slug),
        );
        const remaining =
          measuredWindows.length > 0
            ? Math.min(...measuredWindows.map((window) => 100 - window.usedPercent))
            : null;
        if (remaining !== null) priority -= Math.max(0, 30 - remaining);
        if (
          input.previous?.instanceId === provider.instanceId &&
          input.previous.model === model.slug
        )
          priority += task === "quick" ? 12 : 3;
        priority -= recent.filter((observation) => observation.failed).length * 30;
        const latency = recent.find(
          (observation) => observation.latencyMs !== undefined,
        )?.latencyMs;
        if (latency !== undefined) priority -= Math.min(fast && !quality ? 35 : 12, latency / 3000);
        return [
          { provider, model, priority, free, local, remaining, codeScore, testedComputerUse },
        ];
      });
    })
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        a.provider.instanceId.localeCompare(b.provider.instanceId) ||
        a.model.slug.localeCompare(b.model.slug),
    );
  const best = candidates[0];
  const preferred = input.advice?.preferredSelection;
  const advised = candidates.find(
    (candidate) =>
      candidate.provider.instanceId === preferred?.instanceId &&
      candidate.model.slug === preferred.model,
  );
  const target =
    advised && best && advised.priority >= best.priority - (quality ? 8 : 16) ? advised : best;
  if (!target) return null;
  const reasoningOption =
    thinking && !trivial
      ? target.model.capabilities?.optionDescriptors?.find(
          (option) =>
            option.type === "select" &&
            (option.role === "reasoning" ||
              ["reasoningEffort", "effort", "reasoning", "thought_level"].includes(option.id)),
        )
      : undefined;
  const effort =
    reasoningOption?.type === "select"
      ? (fast || economy ? ["high", "xhigh", "max"] : ["max", "xhigh", "high"]).find((value) =>
          reasoningOption.options.some((choice) => choice.id === value),
        )
      : undefined;
  const evidence =
    target.codeScore !== undefined
      ? `; Terminal-Bench ${benchmarkSnapshot.terminalVersion}, лучший опубликованный режим: ${target.codeScore}% (${BENCHMARK_SOURCES.coding}); проверено ${benchmarkSnapshot.checkedAt.slice(0, 10)}`
      : target.testedComputerUse
        ? `; опубликована оценка OSWorld 2.1 (${TERRA_OSWORLD_SOURCE})`
        : "";
  const taskLabel = {
    quick: "короткая задача",
    code: "работа с кодом",
    reasoning: "сложная задача",
    vision: "изображения",
    computer: "управление ПК",
  }[task];
  return {
    selection: {
      instanceId: target.provider.instanceId,
      model: target.model.slug,
      ...(reasoningOption && effort
        ? { options: [{ id: reasoningOption.id, value: effort }] }
        : {}),
    },
    reason: `${taskLabel}; ${target.local ? "локальная модель" : target.free ? "бесплатный маршрут" : "подключённая подписка"}; ${target.remaining !== null ? `остаток квоты ${Math.round(target.remaining)}%` : "числовая квота не предоставлена"}; выбор из ${candidates.length} доступных маршрутов${evidence}${advised === target && input.advice ? `; совет нейророутера: ${input.advice.reason}` : ""}`,
    alternatives: candidates.length,
  };
}
