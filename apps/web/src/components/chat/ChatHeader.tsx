import {
  type EditorId,
  type ResolvedKeybindingsConfig,
  type ExecutionTargetId,
  type ProjectScript,
  type ThreadId,
} from "@t3tools/contracts";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { DiffIcon, TerminalSquare } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  diffToggleShortcutLabel: string | null;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  gitCwd: string | null;
  targetId: ExecutionTargetId;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  diffToggleShortcutLabel,
  terminalOpen,
  terminalToggleShortcutLabel,
  gitCwd,
  targetId,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0" />
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge variant="outline" className="hidden min-w-0 shrink truncate sm:inline-flex">
            {activeProjectName}
          </Badge>
        )}
        {activeProjectName && !isGitRepo && (
          <Badge
            variant="outline"
            className="hidden shrink-0 text-[10px] text-amber-700 sm:inline-flex"
          >
            No Git
          </Badge>
        )}
      </div>
      <div className="@container/header-actions flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2 @sm/header-actions:gap-3">
        {activeProjectScripts && (
          <div className="hidden sm:block">
            <ProjectScriptsControl
              scripts={activeProjectScripts}
              keybindings={keybindings}
              preferredScriptId={preferredScriptId}
              onRunScript={onRunProjectScript}
              onAddScript={onAddProjectScript}
              onUpdateScript={onUpdateProjectScript}
              onDeleteScript={onDeleteProjectScript}
            />
          </div>
        )}
        {activeProjectName && (
          <div className="hidden sm:block">
            <OpenInPicker
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInCwd={openInCwd}
            />
          </div>
        )}
        {activeProjectName && (
          <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} targetId={targetId} />
        )}
        {activeProjectName && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={terminalOpen}
                  onPressedChange={onToggleTerminal}
                  aria-label="Toggle project terminal"
                  variant="outline"
                  size="xs"
                >
                  <TerminalSquare className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {terminalToggleShortcutLabel
                ? `Toggle project terminal (${terminalToggleShortcutLabel})`
                : "Toggle project terminal"}
            </TooltipPopup>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
