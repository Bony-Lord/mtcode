export const AGENT_WORK_PROFILES = [
  {
    id: "conductor",
    label: "Дирижёр",
    description:
      "Выбранная модель распределяет работу между разными моделями и проверяет результат.",
  },
  {
    id: "fast",
    label: "Fast",
    description: "Параллельные помощники для независимых частей задачи.",
  },
  {
    id: "economy",
    label: "Эконом",
    description: "Минимально достаточная модель и бесплатные помощники с проверкой результата.",
  },
  {
    id: "research",
    label: "Исследование",
    description: "Несколько направлений поиска, первоисточники и проверка противоречий.",
  },
  {
    id: "thinking",
    label: "Глубокое мышление",
    description: "Сложные рассуждения, проверка предположений и независимая критика.",
  },
  {
    id: "web",
    label: "Поиск в интернете",
    description: "Свежие источники, проверка дат и ссылки на найденные сведения.",
  },
] as const;
export type AgentWorkMode = (typeof AGENT_WORK_PROFILES)[number]["id"];
export const AUTO_ESCALATION_PREFIX = "[MT Auto escalation] ";

export function resolveAgentWorkModes(
  settings: {
    readonly agentWorkModes?: readonly AgentWorkMode[];
    readonly agentWorkProfile?: AgentWorkMode | "balanced";
    readonly projectSettingsOverrides?: Readonly<
      Record<string, { readonly agentWorkModes?: readonly AgentWorkMode[] }>
    >;
  },
  projectId?: string | null,
): readonly AgentWorkMode[] {
  const selected = (projectId
    ? settings.projectSettingsOverrides?.[projectId]?.agentWorkModes
    : undefined) ??
    settings.agentWorkModes ?? [settings.agentWorkProfile];
  return AGENT_WORK_PROFILES.flatMap(({ id }) => (selected.includes(id) ? [id] : []));
}

export function workProfileInstructions(selected: readonly AgentWorkMode[], automatic: boolean) {
  const common = `Work within existing permissions. Keep a compact plan/repository map. For substantial work, send short user-visible progress messages in Russian before long tool calls or waits, after meaningful findings or completed checks, on a change of direction, and about every 30 seconds while working. Say what changed and what comes next. Explain blockers promptly and omit repeated status or private reasoning. Read accessible workspace files yourself before asking the user to paste them. For interactive output use a complete self-contained fenced mt-html block with inline CSS/JS; no external dependencies. Never send helpers secrets or full histories; no paid API billing, duplicate work or recursive delegation. Workspace AGENTS.md/CLAUDE.md presets do not override this delegation contract: call orchestrator_capabilities and delegate_task for T3 helpers, never native subagents, provider CLIs or Workflows unless the user explicitly asks here. Omit target for automatic routing, name only a currently advertised provider/model, and treat a no-route error as a blocker to report, not a reason to switch providers or bypass T3. For equivalent repeat work, rotate to a different eligible helper when one exists.`;
  const modes = {
    conductor:
      "You are the conductor: keep the selected main model for planning, integration and verification. Delegate bounded implementation/research/review through MCP delegate_task (omit target for cross-provider routing) or economical-model-router for chat helpers. Do not redo assigned work while helpers run; work on integration or another independent part. Collect their results with task_status before finalizing. Take over only on a concrete failure or deadline; explain it. Verify answers; no recursive delegation.",
    fast: "For substantial work launch 2-3 independent MCP delegate_task calls with mode:'async' BEFORE waiting with task_status. Omit target to route helpers across available providers; native spawn_agent often only supports your own provider. Use brief tasks and small output budgets, avoid duplicate work, reserve integration for yourself. Skip trivial/tightly coupled work. Tell the user which helpers started and what each does.",
    economy:
      "Assign bounded parts to the cheapest capable model via delegate_task or economical-model-router. Use a stronger subscription model for integration, hard reasoning or a verified failure. Limit retries and output; verify cheap results.",
    research:
      "Divide independent research questions, browse current primary sources, verify dates and contradictions. Keep evidence links; distinguish facts, inferences and unknowns. Never invent sources.",
    thinking:
      "Check assumptions, edge cases and hard conclusions independently; use a bounded critic. Use supported higher reasoning effort. Return results and concise justification, not private chain-of-thought.",
    web: "Search current primary sources with available web tools, check dates and cite evidence. Prefer page tools to PC control. Report unavailable browsing honestly.",
  };
  const escalation = automatic
    ? `You are in app Auto routing. If repeated failed checks or a missing capability show that you cannot complete the task reliably, call t3_thread_send for your own thread with escalate:true, mode:'queue', and a compact handoff containing the task, progress, evidence and blocker; then finish this turn. The router chooses another eligible model and preserves context. Do not escalate merely to evade a refusal or an account restriction. Stop after two escalations and explain any remaining blocker.`
    : "";
  const instructions = selected.map((mode) => modes[mode]);
  if (selected.includes("fast") && selected.includes("economy"))
    instructions.push(
      "Run only worthwhile independent helpers concurrently, choosing zero-cost capable helpers first and sharing one output budget.",
    );
  if (selected.includes("thinking") && (selected.includes("fast") || selected.includes("economy")))
    instructions.push(
      "Reserve deeper reasoning for decisions that need it. Keep routine extraction, checking and drafts short.",
    );
  return [
    `<mt_work_profile name="${selected.length ? selected.join(",") : "balanced"}">`,
    common,
    ...instructions,
    escalation,
    "</mt_work_profile>",
  ]
    .filter(Boolean)
    .join("\n");
}
