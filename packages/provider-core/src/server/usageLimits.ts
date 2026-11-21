import { HttpClientRequest } from "effect/http";
import type {
  ProviderUsageLimitsUpdate,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";

const WINDOW_KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function sortWindows(
  windows: Iterable<ServerProviderUsageWindow>,
): ReadonlyArray<ServerProviderUsageWindow> {
  return [...windows].toSorted(
    (left, right) =>
      WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind] ||
      left.id.localeCompare(right.id),
  );
}

export function makeUsageLimits(input: {
  readonly checkedAt: string;
  readonly windows: Iterable<ServerProviderUsageWindow>;
}): ServerProviderUsageLimits {
  return { checkedAt: input.checkedAt, windows: sortWindows(input.windows) };
}

export function makeUnavailableUsageLimits(input: {
  readonly checkedAt: string;
  readonly reason: "unsupported" | "probeFailed";
  readonly message?: string;
}): ServerProviderUsageLimits {
  return {
    checkedAt: input.checkedAt,
    windows: [],
    unavailable: {
      reason: input.reason,
      ...(input.message ? { message: input.message } : {}),
    },
  };
}

export function applyUsageLimitsUpdate(input: {
  readonly previous: ServerProviderUsageLimits | undefined;
  readonly update: ProviderUsageLimitsUpdate;
  readonly checkedAt: string;
}): ServerProviderUsageLimits | undefined {
  const { previous, update } = input;
  const observation = update.windows.some((window) => window.observedUntil !== undefined);
  if (
    update.windows.length === 0 ||
    (!observation && previous?.unavailable?.reason === "unsupported")
  ) {
    return previous;
  }
  const merged = new Map(previous?.windows.map((window) => [window.id, window] as const));
  // Codex repeats unchanged limits on token ticks; avoid allocating snapshots for no-ops.
  let changed = false;
  for (const window of update.windows) {
    const existing = merged.get(window.id);
    const next: ServerProviderUsageWindow = {
      ...window,
      usedPercent: clampPercent(window.usedPercent),
      ...(window.observedUntil === undefined &&
      window.resetsAt === undefined &&
      existing?.resetsAt !== undefined
        ? { resetsAt: existing.resetsAt }
        : {}),
      ...(window.windowDurationMins === undefined && existing?.windowDurationMins !== undefined
        ? { windowDurationMins: existing.windowDurationMins }
        : {}),
    };
    if (existing === undefined || !usageWindowEquals(existing, next)) {
      merged.set(window.id, next);
      changed = true;
    }
  }
  if (!changed && previous !== undefined) {
    return previous;
  }
  const unavailable = observation
    ? undefined
    : previous === undefined
      ? { reason: "probeFailed" as const }
      : previous.unavailable;
  return {
    ...makeUsageLimits({
      checkedAt:
        observation && previous?.windows.some((window) => window.observedUntil === undefined)
          ? previous.checkedAt
          : input.checkedAt,
      windows: merged.values(),
    }),
    ...(previous?.plan !== undefined ? { plan: previous.plan } : {}),
    ...(previous?.externalUsage !== undefined ? { externalUsage: previous.externalUsage } : {}),
    ...(previous?.credentialFingerprint !== undefined
      ? { credentialFingerprint: previous.credentialFingerprint }
      : {}),
    ...(previous?.resetCredits !== undefined ? { resetCredits: previous.resetCredits } : {}),
    ...(previous?.zeroSpendCap ? { zeroSpendCap: true } : {}),
    ...(unavailable !== undefined ? { unavailable } : {}),
  };
}

function usageWindowEquals(a: ServerProviderUsageWindow, b: ServerProviderUsageWindow): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.usedPercent === b.usedPercent &&
    (a.modelIds === b.modelIds ||
      (a.modelIds !== undefined &&
        b.modelIds !== undefined &&
        a.modelIds.length === b.modelIds.length &&
        a.modelIds.every((id, index) => id === b.modelIds?.[index]))) &&
    (a.providerIds === b.providerIds ||
      (a.providerIds !== undefined &&
        b.providerIds !== undefined &&
        a.providerIds.length === b.providerIds.length &&
        a.providerIds.every((id, index) => id === b.providerIds?.[index]))) &&
    (a.modelFamilies === b.modelFamilies ||
      (a.modelFamilies !== undefined &&
        b.modelFamilies !== undefined &&
        a.modelFamilies.length === b.modelFamilies.length &&
        a.modelFamilies.every((id, index) => id === b.modelFamilies?.[index]))) &&
    a.resetsAt === b.resetsAt &&
    a.observedUntil === b.observedUntil &&
    a.windowDurationMins === b.windowDurationMins
  );
}

export function resolveUsageLimitsAfterProbe(input: {
  readonly published: ServerProviderUsageLimits | undefined;
  readonly probed: ServerProviderUsageLimits | undefined;
}): ServerProviderUsageLimits | undefined {
  const { published, probed } = input;
  const observed =
    published?.windows.filter(
      (window) =>
        window.observedUntil !== undefined &&
        (!probed || Date.parse(window.observedUntil) > Date.parse(probed.checkedAt)),
    ) ?? [];
  if (published && !probed && observed.length > 0) return { ...published, windows: observed };
  if (
    published &&
    probed &&
    observed.length > 0 &&
    (!probed.credentialFingerprint ||
      !published.credentialFingerprint ||
      probed.credentialFingerprint === published.credentialFingerprint)
  ) {
    const { unavailable: _unavailable, ...reported } = probed;
    const numeric = probed.windows.filter((window) => window.observedUntil === undefined);
    const liveObserved = observed.filter(
      (window) =>
        !numeric.some(
          (measurement) =>
            measurement.modelIds?.some((model) => window.modelIds?.includes(model)) &&
            Date.parse(probed.checkedAt) >= Date.parse(published.checkedAt),
        ),
    );
    if (liveObserved.length > 0) {
      return { ...reported, windows: sortWindows([...numeric, ...liveObserved]) };
    }
  }
  if (probed?.unavailable?.reason === "probeFailed" && published && !published.unavailable) {
    return published;
  }
  if (
    published &&
    probed &&
    !published.unavailable &&
    !probed.unavailable &&
    Date.parse(published.checkedAt) > Date.parse(probed.checkedAt)
  ) {
    return { ...probed, checkedAt: published.checkedAt, windows: published.windows };
  }
  return probed;
}

export const CHATGPT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export function chatGptUsageRequest(accessToken: string, accountId?: string) {
  const request = HttpClientRequest.get(CHATGPT_USAGE_URL).pipe(
    HttpClientRequest.bearerToken(accessToken),
    HttpClientRequest.setHeader("Accept", "application/json"),
  );
  return accountId
    ? request.pipe(HttpClientRequest.setHeader("ChatGPT-Account-Id", accountId))
    : request;
}

function chatGptUsageRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function chatGptUsageNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function chatGptUsageWindow(value: unknown, fallbackMins: number) {
  const window = chatGptUsageRecord(value);
  const usedPercent = chatGptUsageNumber(window?.used_percent);
  if (usedPercent === undefined) return null;
  const seconds = chatGptUsageNumber(window?.limit_window_seconds);
  const windowDurationMins = seconds && seconds > 0 ? Math.round(seconds / 60) : fallbackMins;
  const kind =
    windowDurationMins >= 28 * 1440
      ? "monthly"
      : windowDurationMins === 7 * 1440
        ? "weekly"
        : windowDurationMins <= 300
          ? "session"
          : "other";
  const label = { monthly: "Monthly", weekly: "Weekly", session: "Session", other: "Other" }[kind];
  const reset = chatGptUsageNumber(window?.reset_at);
  const resetDate = reset && reset > 0 ? new Date(reset * 1000) : null;
  return {
    kind,
    label,
    usedPercent: clampPercent(usedPercent),
    windowDurationMins,
    ...(resetDate && Number.isFinite(resetDate.getTime())
      ? { resetsAt: resetDate.toISOString() }
      : {}),
  } as const;
}

/** The subscription endpoint provides primary/secondary windows and optional model-specific pools. */
export function chatGptUsageToWindows(payload: unknown): ReadonlyArray<ServerProviderUsageWindow> {
  const usage = chatGptUsageRecord(payload);
  const defaultMins = usage?.plan_type === "free" || usage?.plan_type === "go" ? 30 * 1440 : 300;
  const readWindows = (value: unknown, prefix: string, group?: string, model?: string) => {
    const rateLimit = chatGptUsageRecord(value);
    const positions = [
      ["primary", rateLimit?.primary_window, defaultMins],
      ["secondary", rateLimit?.secondary_window, 7 * 1440],
    ] as const;
    return positions.flatMap(([slot, entry, duration]) => {
      const window = chatGptUsageWindow(entry, duration);
      return window
        ? [
            {
              ...window,
              id: prefix + slot,
              label: (group ?? "ChatGPT") + " · " + window.label,
              ...(model !== undefined
                ? { modelIds: /^gpt-[\w.-]+$/u.test(model) ? [model] : [] }
                : {}),
            },
          ]
        : [];
    });
  };
  const additional = Array.isArray(usage?.additional_rate_limits)
    ? usage.additional_rate_limits
    : [];
  return [
    ...readWindows(usage?.rate_limit, "chatgpt_"),
    ...additional.flatMap((entry) => {
      const pool = chatGptUsageRecord(entry);
      const id = pool?.metered_feature ?? pool?.limit_name;
      if (typeof id !== "string" || !id.trim()) return [];
      const name = typeof pool?.limit_name === "string" ? pool.limit_name : id;
      return readWindows(
        pool?.rate_limit,
        "chatgpt:" + id + ":",
        name,
        id === "codex_bengalfox" ? "gpt-5.3-codex-spark" : id,
      );
    }),
  ];
}
