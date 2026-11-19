import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { AGENT_WORK_PROFILES, resolveAgentWorkModes } from "@t3tools/shared/agentWorkProfiles";
import {
  BrainIcon,
  GlobeIcon,
  MicroscopeIcon,
  PiggyBankIcon,
  ZapIcon,
  NetworkIcon,
} from "lucide-react";
import { useState } from "react";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";

const icons = {
  conductor: NetworkIcon,
  fast: ZapIcon,
  economy: PiggyBankIcon,
  research: MicroscopeIcon,
  thinking: BrainIcon,
  web: GlobeIcon,
};

export function AgentWorkProfilePicker({
  environmentId,
  projectId,
  disabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId?: ProjectId | null;
  readonly disabled: boolean;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const modes = resolveAgentWorkModes(settings, projectId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [pending, setPending] = useState<ReturnType<typeof resolveAgentWorkModes> | null>(null);
  const selected = pending ?? modes;
  return (
    <div role="group" aria-label="Режимы работы агента" className="flex shrink-0 items-center">
      {AGENT_WORK_PROFILES.map(({ id, label, description }) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={
              <ComposerControl
                size="xs"
                aria-label={label}
                aria-pressed={selected.includes(id)}
                disabled={disabled || pending !== null}
                onClick={() => {
                  const next = selected.includes(id)
                    ? selected.filter((mode) => mode !== id)
                    : [...selected, id];
                  setPending(next);
                  updateSettings(
                    projectId
                      ? { projectSettingsOverrides: { [projectId]: { agentWorkModes: next } } }
                      : { agentWorkModes: next },
                    {
                      onSaved: () => setPending(null),
                      onFailed: () => setPending(null),
                    },
                  );
                }}
              >
                <ComposerControlIcon icon={icons[id]} size="xs" />
              </ComposerControl>
            }
          />
          <TooltipPopup side="top">
            {label}. {description}
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
