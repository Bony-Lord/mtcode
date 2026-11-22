import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { AGENT_WORK_PROFILES, resolveAgentWorkModes } from "@t3tools/shared/agentWorkProfiles";
import {
  BrainIcon,
  GlobeIcon,
  MicroscopeIcon,
  MoonIcon,
  PiggyBankIcon,
  ZapIcon,
  NetworkIcon,
} from "lucide-react";
import { useState } from "react";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";

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
  const [pendingKeepAwake, setPendingKeepAwake] = useState<boolean | null>(null);
  const selected = pending ?? modes;
  const keepAwake = pendingKeepAwake ?? settings.keepAwakeWhileAgentsWork;
  const saving = pending !== null || pendingKeepAwake !== null;
  return (
    <div role="group" aria-label="Режимы работы агента" className="flex shrink-0 items-center">
      {AGENT_WORK_PROFILES.map(({ id, label, description }) => {
        const Icon = icons[id];
        return (
          <Tooltip key={id}>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant={selected.includes(id) ? "secondary" : "ghost"}
                  aria-label={label}
                  aria-pressed={selected.includes(id)}
                  disabled={disabled || saving}
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
                  <Icon />
                </Button>
              }
            />
            <TooltipPopup side="top">
              {label}. {description}
            </TooltipPopup>
          </Tooltip>
        );
      })}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant={keepAwake ? "secondary" : "ghost"}
              aria-label="Не спать"
              aria-pressed={keepAwake}
              disabled={disabled || saving}
              onClick={() => {
                const next = !keepAwake;
                setPendingKeepAwake(next);
                updateSettings(
                  { keepAwakeWhileAgentsWork: next },
                  {
                    onSaved: () => setPendingKeepAwake(null),
                    onFailed: () => setPendingKeepAwake(null),
                  },
                );
              }}
            >
              <MoonIcon />
            </Button>
          }
        />
        <TooltipPopup side="top">
          Не давать компьютеру переходить в спящий режим, пока работают агенты.
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
