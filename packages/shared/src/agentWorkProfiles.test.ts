import { expect, it } from "vite-plus/test";
import {
  AGENT_WORK_PROFILES,
  resolveAgentWorkModes,
  workProfileInstructions,
} from "./agentWorkProfiles.ts";

it("keeps every mode combination inside Codex's context entry limit", () => {
  for (let mask = 0; mask < 2 ** AGENT_WORK_PROFILES.length; mask++) {
    const modes = AGENT_WORK_PROFILES.filter((_, index) => (mask & (1 << index)) !== 0).map(
      ({ id }) => id,
    );
    const context = workProfileInstructions(modes, true);
    expect(new TextEncoder().encode(context).length).toBeLessThanOrEqual(4000);
    expect(context).toContain("escalate:true");
  }
});

it("keeps saved single modes and treats an empty list as an explicit reset", () => {
  expect(
    resolveAgentWorkModes(
      {
        agentWorkModes: ["fast"],
        projectSettingsOverrides: { game: { agentWorkModes: ["conductor"] } },
      },
      "game",
    ),
  ).toEqual(["conductor"]);
  expect(
    resolveAgentWorkModes(
      { agentWorkModes: ["fast"], projectSettingsOverrides: { game: { agentWorkModes: [] } } },
      "game",
    ),
  ).toEqual([]);
  expect(resolveAgentWorkModes({ agentWorkProfile: "economy" })).toEqual(["economy"]);
  expect(resolveAgentWorkModes({ agentWorkProfile: "economy", agentWorkModes: [] })).toEqual([]);
  expect(resolveAgentWorkModes({ agentWorkModes: ["thinking", "fast", "fast", "web"] })).toEqual([
    "fast",
    "thinking",
    "web",
  ]);
});
