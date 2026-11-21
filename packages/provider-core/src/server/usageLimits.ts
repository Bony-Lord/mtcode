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
