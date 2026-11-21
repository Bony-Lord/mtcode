import { ProviderInstanceId, type ProviderDriverKind } from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { isSmartModel } from "@t3tools/shared/smartModelRouting";
import { type ProviderInstanceEntry } from "../../providerInstances";

import type { ModelEsque } from "./providerIconUtils";

export const AUTO_APP_MODEL_OPTION: ModelEsque = {
  slug: "mt-auto",
  name: "Авто · все провайдеры",
  shortName: "Авто",
  badge: "new",
};
export const AUTO_APP_MODEL_OPTIONS: ReadonlyArray<ModelEsque> = [
  AUTO_APP_MODEL_OPTION,
  {
    ...AUTO_APP_MODEL_OPTION,
    slug: "mt-auto/fast",
    name: "Авто · быстрее",
    shortName: "Авто · быстро",
  },
  {
    ...AUTO_APP_MODEL_OPTION,
    slug: "mt-auto/economy",
    name: "Авто · экономия",
    shortName: "Авто · эконом",
  },
  {
    ...AUTO_APP_MODEL_OPTION,
    slug: "mt-auto/quality",
    name: "Авто · сложные задачи",
    shortName: "Авто · качество",
  },
  {
    ...AUTO_APP_MODEL_OPTION,
    slug: "mt-auto/subscription",
    name: "Авто · только подписки",
    shortName: "Авто · подписки",
  },
];

export const AUTO_PROFILE_ID = ProviderInstanceId.make("mt-auto-profile");

/** App routing modes are resolved by the orchestrator, outside a provider's native catalog. */
export function resolvePickerModel(
  driver: ProviderDriverKind,
  slug: string,
  models: readonly ModelEsque[],
) {
  return isSmartModel(slug) ? slug : resolveSelectableModel(driver, slug, models);
}

/** Saved account logins share a provider tab; separate gateways keep their catalogs. */
export function providerAccountGroups(entries: readonly ProviderInstanceEntry[]) {
  const groups = new Map<string, ProviderInstanceEntry[]>();
  for (const entry of entries) {
    const key = ["codex", "claudeAgent", "antigravity"].includes(entry.driverKind)
      ? entry.driverKind
      : entry.instanceId;
    const members = groups.get(key) ?? [];
    members.push(entry);
    groups.set(key, members);
  }
  return [...groups.values()].map((accounts) => {
    const ready = accounts.filter((entry) => entry.enabled && entry.status === "ready");
    const representative =
      ready.find((entry) => entry.isDefault) ??
      ready[0] ??
      accounts.find((entry) => entry.isDefault) ??
      accounts[0]!;
    return { representative, accounts };
  });
}

export function providerLoginGroups(accounts: readonly ProviderInstanceEntry[]) {
  const emailFor = (entry: ProviderInstanceEntry) =>
    entry.driverKind === "codex" && entry.snapshot.auth.status === "authenticated"
      ? entry.snapshot.auth.email?.trim().toLowerCase()
      : undefined;
  const workspaces = new Map<string, Set<string>>();
  for (const entry of accounts) {
    const email = emailFor(entry);
    const workspace = entry.snapshot.auth.workspaceId;
    if (!email || !workspace) continue;
    const known = workspaces.get(email) ?? new Set<string>();
    known.add(workspace);
    workspaces.set(email, known);
  }
  const groups = new Map<string, ProviderInstanceEntry[]>();
  for (const entry of accounts) {
    const email = emailFor(entry);
    const known = email ? workspaces.get(email) : undefined;
    const workspace =
      entry.snapshot.auth.workspaceId ?? (known?.size === 1 ? [...known][0] : undefined);
    const key =
      email && (workspace || !known) ? JSON.stringify([email, workspace]) : entry.instanceId;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()];
}

/** Keeps a hidden model visible while its provider is locked or turned off. */
export function retainedModelWhileProviderLocked(
  entry: {
    readonly driverKind: ProviderDriverKind;
    readonly enabled: boolean;
    readonly isAvailable: boolean;
    readonly models: ReadonlyArray<Pick<ModelEsque, "slug" | "name" | "shortName" | "subProvider">>;
  } | null,
  model: string,
): ModelEsque | undefined {
  if (!entry || (entry.enabled && entry.isAvailable) || !model) return undefined;
  if (
    entry.driverKind === "opencode" ||
    entry.driverKind === "antigravity" ||
    entry.driverKind === "devin"
  ) {
    return undefined;
  }
  return entry.models.find((candidate) => candidate.slug === model) ?? { slug: model, name: model };
}
