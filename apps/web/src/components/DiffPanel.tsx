import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { LOCAL_EXECUTION_TARGET_ID, ThreadId, type TurnId } from "@t3tools/contracts";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  FolderIcon,
  FolderOpenIcon,
  Maximize2Icon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  Rows3Icon,
  XIcon,
} from "lucide-react";
import {
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openInPreferredEditor } from "../editorPreferences";
import { gitBranchesQueryOptions } from "~/lib/gitReactQuery";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { cn } from "~/lib/utils";
import { readNativeApi } from "../nativeApi";
import { resolvePathLinkTarget } from "../terminal-links";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useTheme } from "../hooks/useTheme";
import { buildPatchCacheKey } from "../lib/diffRendering";
import { resolveDiffThemeName } from "../lib/diffRendering";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useStore } from "../store";
import { Button } from "./ui/button";
import { useAppSettings } from "../appSettings";
import { formatShortTimestamp } from "../timestampFormat";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { ToggleGroup, Toggle } from "./ui/toggle-group";

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";
type DiffFileTreeNode =
  | {
      kind: "directory";
      id: string;
      name: string;
      path: string;
      children: DiffFileTreeNode[];
    }
  | {
      kind: "file";
      id: string;
      name: string;
      path: string;
      fileDiff: FileDiffMetadata;
    };
type DiffFileTreeFileNode = Extract<DiffFileTreeNode, { kind: "file" }>;
type MutableDiffFileTreeDirectoryNode = {
  kind: "directory";
  id: string;
  name: string;
  path: string;
  children: MutableDiffFileTreeNode[];
  childDirectoryByName: Map<string, MutableDiffFileTreeDirectoryNode>;
};
type MutableDiffFileTreeNode = MutableDiffFileTreeDirectoryNode | DiffFileTreeFileNode;

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  );

  background-color: var(--diffs-bg) !important;
}

@media (pointer: coarse) {
  [data-diff],
  [data-file],
  [data-error-wrapper],
  [data-code],
  [data-content],
  [data-line],
  [data-column-number] {
    touch-action: auto !important;
  }

  [data-code] {
    overflow: visible !important;
    overscroll-behavior: auto !important;
  }
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;

type RenderablePatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

function getRenderablePatch(
  patch: string | undefined,
  cacheScope = "diff-panel",
): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    );
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    if (files.length > 0) {
      return { kind: "files", files };
    }

    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

function finalizeDiffFileTreeChildren(
  children: readonly MutableDiffFileTreeNode[],
): DiffFileTreeNode[] {
  return children
    .map(
      (child): DiffFileTreeNode =>
        child.kind === "directory"
          ? {
              kind: "directory",
              id: child.id,
              name: child.name,
              path: child.path,
              children: finalizeDiffFileTreeChildren(child.children),
            }
          : child,
    )
    .toSorted((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
}

function buildDiffFileTree(files: readonly FileDiffMetadata[]): DiffFileTreeNode[] {
  const root: MutableDiffFileTreeDirectoryNode = {
    kind: "directory",
    id: "__root__",
    name: "",
    path: "",
    children: [],
    childDirectoryByName: new Map(),
  };

  for (const fileDiff of files) {
    const filePath = resolveFileDiffPath(fileDiff);
    const pathSegments = filePath.split("/").filter(Boolean);
    if (pathSegments.length === 0) {
      continue;
    }

    let directoryCursor = root;
    for (let index = 0; index < pathSegments.length - 1; index += 1) {
      const segment = pathSegments[index];
      if (!segment) {
        continue;
      }
      const directoryPath = pathSegments.slice(0, index + 1).join("/");
      let nextDirectory = directoryCursor.childDirectoryByName.get(segment);
      if (!nextDirectory) {
        nextDirectory = {
          kind: "directory",
          id: `dir:${directoryPath}`,
          name: segment,
          path: directoryPath,
          children: [],
          childDirectoryByName: new Map(),
        };
        directoryCursor.childDirectoryByName.set(segment, nextDirectory);
        directoryCursor.children.push(nextDirectory);
      }
      directoryCursor = nextDirectory;
    }

    const fileName = pathSegments[pathSegments.length - 1] ?? filePath;
    directoryCursor.children.push({
      kind: "file",
      id: `file:${filePath}`,
      name: fileName,
      path: filePath,
      fileDiff,
    });
  }

  return finalizeDiffFileTreeChildren(root.children);
}

function collectExpandedDirectoryPaths(nodes: readonly DiffFileTreeNode[]): string[] {
  const directoryPaths: string[] = [];

  const visit = (entries: readonly DiffFileTreeNode[]) => {
    for (const entry of entries) {
      if (entry.kind !== "directory") {
        continue;
      }
      directoryPaths.push(entry.path);
      visit(entry.children);
    }
  };

  visit(nodes);
  return directoryPaths;
}

function DiffFileTree(props: {
  activeFilePath: string | null;
  expandedDirectories: Record<string, boolean>;
  nodes: readonly DiffFileTreeNode[];
  onOpenInEditor: (filePath: string) => void;
  onSelectFile: (filePath: string) => void;
  onToggleDirectory: (directoryPath: string) => void;
  onToggleVisibility?: () => void;
  showVisibilityToggle?: boolean;
}) {
  return (
    <div className="diff-file-tree-scroll flex min-h-0 flex-col border-b border-border/70 bg-card/35 md:w-64 md:shrink-0 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground/70 uppercase">
          Changed files
        </p>
        {props.showVisibilityToggle && props.onToggleVisibility && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            aria-label="Hide files"
            onClick={props.onToggleVisibility}
          >
            <PanelLeftCloseIcon className="size-4" />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        <div className="space-y-0.5">
          {props.nodes.map((node) => (
            <DiffFileTreeNodeRow
              key={node.id}
              activeFilePath={props.activeFilePath}
              depth={0}
              expandedDirectories={props.expandedDirectories}
              node={node}
              onOpenInEditor={props.onOpenInEditor}
              onSelectFile={props.onSelectFile}
              onToggleDirectory={props.onToggleDirectory}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffFileTreeNodeRow(props: {
  activeFilePath: string | null;
  depth: number;
  expandedDirectories: Record<string, boolean>;
  node: DiffFileTreeNode;
  onOpenInEditor: (filePath: string) => void;
  onSelectFile: (filePath: string) => void;
  onToggleDirectory: (directoryPath: string) => void;
}) {
  const {
    activeFilePath,
    depth,
    expandedDirectories,
    node,
    onOpenInEditor,
    onSelectFile,
    onToggleDirectory,
  } = props;

  if (node.kind === "directory") {
    const isExpanded = expandedDirectories[node.path] ?? true;
    return (
      <div>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground/80 transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={() => onToggleDirectory(node.path)}
          style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
        >
          <ChevronRightIcon
            className={cn("size-3.5 shrink-0 transition-transform", isExpanded && "rotate-90")}
          />
          {isExpanded ? (
            <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground/80" />
          ) : (
            <FolderIcon className="size-4 shrink-0 text-muted-foreground/80" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && (
          <div className="space-y-0.5">
            {node.children.map((child) => (
              <DiffFileTreeNodeRow
                key={child.id}
                activeFilePath={activeFilePath}
                depth={depth + 1}
                expandedDirectories={expandedDirectories}
                node={child}
                onOpenInEditor={onOpenInEditor}
                onSelectFile={onSelectFile}
                onToggleDirectory={onToggleDirectory}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isActive = node.path === activeFilePath;
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground/80 hover:bg-accent/60 hover:text-foreground",
      )}
      title={node.path}
      onClick={() => onSelectFile(node.path)}
      onDoubleClick={() => onOpenInEditor(node.path)}
      style={{ paddingLeft: `${depth * 0.75 + 1.75}rem` }}
    >
      <span className="truncate">{node.name}</span>
    </button>
  );
}

interface DiffPanelProps {
  mode?: DiffPanelMode;
  onCloseDiff?: () => void;
  variant?: "compact" | "full";
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({
  mode = "inline",
  onCloseDiff,
  variant = "compact",
}: DiffPanelProps) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { settings } = useAppSettings();
  const isMobileViewport = useMediaQuery("(max-width: 767px)");
  const isTouchViewport = useMediaQuery("(pointer: coarse), (hover: none)");
  const shouldUseCompactMobileHeader = isMobileViewport || isTouchViewport;
  const shouldShowTurnStripScrollButtons = !shouldUseCompactMobileHeader;
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>(
    variant === "full" ? "split" : "stacked",
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const [isMobileFileTreeOpen, setIsMobileFileTreeOpen] = useState(true);
  const patchViewportRef = useRef<HTMLDivElement>(null);
  const turnStripRef = useRef<HTMLDivElement>(null);
  const [canScrollTurnStripLeft, setCanScrollTurnStripLeft] = useState(false);
  const [canScrollTurnStripRight, setCanScrollTurnStripRight] = useState(false);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const diffSearch = useSearch({ strict: false, select: (search) => parseDiffRouteSearch(search) });
  const activeThreadId = routeThreadId;
  const activeThread = useStore((store) =>
    activeThreadId ? store.threads.find((thread) => thread.id === activeThreadId) : undefined,
  );
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeProjectId ? store.projects.find((project) => project.id === activeProjectId) : undefined,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd;
  const targetId = activeThread?.targetId ?? LOCAL_EXECUTION_TARGET_ID;
  const gitBranchesQuery = useQuery(gitBranchesQueryOptions({ cwd: activeCwd ?? null, targetId }));
  const isGitRepo = gitBranchesQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  const selectedTurnId = diffSearch.diffTurnId ?? null;
  const selectedFilePath =
    variant === "full"
      ? (diffSearch.diffFilePath ?? null)
      : selectedTurnId !== null
        ? (diffSearch.diffFilePath ?? null)
        : null;
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0]);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const conversationCheckpointTurnCount = useMemo(() => {
    const turnCounts = orderedTurnDiffSummaries
      .map(
        (summary) =>
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
      )
      .filter((value): value is number => typeof value === "number");
    if (turnCounts.length === 0) {
      return undefined;
    }
    const latest = Math.max(...turnCounts);
    return latest > 0 ? latest : undefined;
  }, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries]);
  const conversationCheckpointRange = useMemo(
    () =>
      !selectedTurn && typeof conversationCheckpointTurnCount === "number"
        ? {
            fromTurnCount: 0,
            toTurnCount: conversationCheckpointTurnCount,
          }
        : null,
    [conversationCheckpointTurnCount, selectedTurn],
  );
  const activeCheckpointRange = selectedTurn
    ? selectedCheckpointRange
    : conversationCheckpointRange;
  const conversationCacheScope = useMemo(() => {
    if (selectedTurn || orderedTurnDiffSummaries.length === 0) {
      return null;
    }
    return `conversation:${orderedTurnDiffSummaries.map((summary) => summary.turnId).join(",")}`;
  }, [orderedTurnDiffSummaries, selectedTurn]);
  const activeCheckpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : conversationCacheScope,
      enabled: isGitRepo,
    }),
  );
  const selectedTurnCheckpointDiff = selectedTurn
    ? activeCheckpointDiffQuery.data?.diff
    : undefined;
  const conversationCheckpointDiff = selectedTurn
    ? undefined
    : activeCheckpointDiffQuery.data?.diff;
  const isLoadingCheckpointDiff = activeCheckpointDiffQuery.isLoading;
  const checkpointDiffError =
    activeCheckpointDiffQuery.error instanceof Error
      ? activeCheckpointDiffQuery.error.message
      : activeCheckpointDiffQuery.error
        ? "Failed to load checkpoint diff."
        : null;

  const selectedPatch = selectedTurn ? selectedTurnCheckpointDiff : conversationCheckpointDiff;
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const renderablePatch = useMemo(
    () => getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`),
    [resolvedTheme, selectedPatch],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);
  const renderableFilesByPath = useMemo(
    () => new Map(renderableFiles.map((fileDiff) => [resolveFileDiffPath(fileDiff), fileDiff])),
    [renderableFiles],
  );
  const fileTreeNodes = useMemo(() => buildDiffFileTree(renderableFiles), [renderableFiles]);
  const activeFilePath = useMemo(() => {
    if (variant !== "full") {
      return selectedFilePath;
    }
    const firstRenderableFile = renderableFiles[0];
    if (!firstRenderableFile) {
      return null;
    }
    if (selectedFilePath && renderableFilesByPath.has(selectedFilePath)) {
      return selectedFilePath;
    }
    return resolveFileDiffPath(firstRenderableFile);
  }, [renderableFiles, renderableFilesByPath, selectedFilePath, variant]);
  const activeFileDiff = activeFilePath
    ? (renderableFilesByPath.get(activeFilePath) ?? null)
    : null;
  const visibleFileDiffs =
    variant === "full" ? (activeFileDiff ? [activeFileDiff] : []) : renderableFiles;
  const shouldCollapseFileTreeOnMobile =
    variant === "full" && (isMobileViewport || isTouchViewport);
  const showFileTree =
    variant === "full" &&
    renderablePatch?.kind === "files" &&
    activeFilePath !== null &&
    (!shouldCollapseFileTreeOnMobile || isMobileFileTreeOpen);

  useEffect(() => {
    if (!shouldCollapseFileTreeOnMobile) {
      setIsMobileFileTreeOpen(true);
    }
  }, [shouldCollapseFileTreeOnMobile]);

  useEffect(() => {
    if (variant !== "full") {
      return;
    }
    if (fileTreeNodes.length === 0) {
      setExpandedDirectories({});
      return;
    }

    const nextExpandedDirectories = Object.fromEntries(
      collectExpandedDirectoryPaths(fileTreeNodes).map((directoryPath) => [directoryPath, true]),
    );
    setExpandedDirectories((current) => {
      let changed = Object.keys(current).length !== Object.keys(nextExpandedDirectories).length;
      const merged = { ...nextExpandedDirectories };
      for (const [directoryPath, isExpanded] of Object.entries(current)) {
        if (!(directoryPath in nextExpandedDirectories)) {
          continue;
        }
        if (merged[directoryPath] !== isExpanded) {
          changed = true;
        }
        merged[directoryPath] = isExpanded;
      }
      return changed ? merged : current;
    });
  }, [fileTreeNodes, variant]);

  useEffect(() => {
    if (variant !== "full") {
      if (!selectedFilePath || !patchViewportRef.current) {
        return;
      }
      const target = Array.from(
        patchViewportRef.current.querySelectorAll<HTMLElement>("[data-diff-file-path]"),
      ).find((element) => element.dataset.diffFilePath === selectedFilePath);
      target?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (!patchViewportRef.current) {
      return;
    }
    patchViewportRef.current.scrollTop = 0;
    patchViewportRef.current.scrollLeft = 0;
  }, [activeFilePath, selectedFilePath, variant]);

  const openDiffFileInEditor = useCallback(
    (filePath: string) => {
      const api = readNativeApi();
      if (!api) return;
      const targetPath = activeCwd ? resolvePathLinkTarget(filePath, activeCwd) : filePath;
      void openInPreferredEditor(api, targetPath).catch((error) => {
        console.warn("Failed to open diff file in editor.", error);
      });
    },
    [activeCwd],
  );
  const diffRouteTo = variant === "full" ? "/$threadId/diff" : "/$threadId";
  const buildDiffSearch = useCallback(
    (next: { diffFilePath?: string; diffTurnId?: TurnId | null }) => {
      return (previous: ReturnType<typeof parseDiffRouteSearch>) => {
        const rest = stripDiffSearchParams(previous as Record<string, unknown>);
        return {
          ...rest,
          ...(variant === "full" ? {} : { diff: "1" as const }),
          ...(next.diffTurnId ? { diffTurnId: next.diffTurnId } : {}),
          ...(next.diffFilePath ? { diffFilePath: next.diffFilePath } : {}),
        };
      };
    },
    [variant],
  );

  const selectTurn = (turnId: TurnId) => {
    if (!activeThread) return;
    void navigate({
      to: diffRouteTo,
      params: { threadId: activeThread.id },
      search: buildDiffSearch({ diffTurnId: turnId }),
    });
  };
  const selectWholeConversation = () => {
    if (!activeThread) return;
    void navigate({
      to: diffRouteTo,
      params: { threadId: activeThread.id },
      search: buildDiffSearch({}),
    });
  };
  const selectFile = useCallback(
    (filePath: string) => {
      if (!activeThread) return;
      if (shouldCollapseFileTreeOnMobile) {
        setIsMobileFileTreeOpen(false);
      }
      void navigate({
        to: diffRouteTo,
        params: { threadId: activeThread.id },
        search: buildDiffSearch({
          diffTurnId: selectedTurnId,
          diffFilePath: filePath,
        }),
      });
    },
    [
      activeThread,
      buildDiffSearch,
      diffRouteTo,
      navigate,
      selectedTurnId,
      shouldCollapseFileTreeOnMobile,
    ],
  );
  const toggleDirectory = useCallback((directoryPath: string) => {
    setExpandedDirectories((current) => ({
      ...current,
      [directoryPath]: !(current[directoryPath] ?? true),
    }));
  }, []);
  const openFullDiff = useCallback(() => {
    if (!routeThreadId) return;
    void navigate({
      to: "/$threadId/diff",
      params: { threadId: routeThreadId },
      search: {
        ...(selectedTurnId ? { diffTurnId: selectedTurnId } : {}),
        ...(activeFilePath ? { diffFilePath: activeFilePath } : {}),
      },
    });
  }, [activeFilePath, navigate, routeThreadId, selectedTurnId]);
  const updateTurnStripScrollState = useCallback(() => {
    const element = turnStripRef.current;
    if (!element) {
      setCanScrollTurnStripLeft(false);
      setCanScrollTurnStripRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setCanScrollTurnStripLeft(element.scrollLeft > 4);
    setCanScrollTurnStripRight(element.scrollLeft < maxScrollLeft - 4);
  }, []);
  const scrollTurnStripBy = useCallback((offset: number) => {
    const element = turnStripRef.current;
    if (!element) return;
    element.scrollBy({ left: offset, behavior: "smooth" });
  }, []);
  const onTurnStripWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const element = turnStripRef.current;
    if (!element) return;
    if (element.scrollWidth <= element.clientWidth + 1) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    event.preventDefault();
    element.scrollBy({ left: event.deltaY, behavior: "auto" });
  }, []);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    const onScroll = () => updateTurnStripScrollState();

    element.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => updateTurnStripScrollState());
    resizeObserver.observe(element);

    return () => {
      window.cancelAnimationFrame(frameId);
      element.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [updateTurnStripScrollState]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [orderedTurnDiffSummaries, selectedTurnId, updateTurnStripScrollState]);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const selectedChip = element.querySelector<HTMLElement>("[data-turn-chip-selected='true']");
    selectedChip?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedTurn?.turnId, selectedTurnId]);

  const closeDiff = useCallback(() => {
    if (onCloseDiff) {
      onCloseDiff();
      return;
    }
    if (!routeThreadId) return;
    void navigate({
      to: "/$threadId",
      params: { threadId: routeThreadId },
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: undefined };
      },
    });
  }, [navigate, onCloseDiff, routeThreadId]);
  const headerRow = (
    <>
      <div className="relative min-w-0 flex-1 [-webkit-app-region:no-drag]">
        {shouldShowTurnStripScrollButtons && canScrollTurnStripLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-8 z-10 w-7 bg-linear-to-r from-card to-transparent" />
        )}
        {shouldShowTurnStripScrollButtons && canScrollTurnStripRight && (
          <div className="pointer-events-none absolute inset-y-0 right-8 z-10 w-7 bg-linear-to-l from-card to-transparent" />
        )}
        {shouldShowTurnStripScrollButtons && (
          <button
            type="button"
            className={cn(
              "absolute left-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
              canScrollTurnStripLeft
                ? "border-border/70 hover:border-border hover:text-foreground"
                : "cursor-not-allowed border-border/40 text-muted-foreground/40",
            )}
            onClick={() => scrollTurnStripBy(-180)}
            disabled={!canScrollTurnStripLeft}
            aria-label="Scroll turn list left"
          >
            <ChevronLeftIcon className="size-3.5" />
          </button>
        )}
        {shouldShowTurnStripScrollButtons && (
          <button
            type="button"
            className={cn(
              "absolute right-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
              canScrollTurnStripRight
                ? "border-border/70 hover:border-border hover:text-foreground"
                : "cursor-not-allowed border-border/40 text-muted-foreground/40",
            )}
            onClick={() => scrollTurnStripBy(180)}
            disabled={!canScrollTurnStripRight}
            aria-label="Scroll turn list right"
          >
            <ChevronRightIcon className="size-3.5" />
          </button>
        )}
        <div
          ref={turnStripRef}
          className={cn(
            "turn-chip-strip flex gap-1 overflow-x-auto py-0.5",
            shouldShowTurnStripScrollButtons ? "px-8" : "px-1",
          )}
          onWheel={onTurnStripWheel}
        >
          <button
            type="button"
            className="shrink-0 rounded-md"
            onClick={selectWholeConversation}
            data-turn-chip-selected={selectedTurnId === null}
          >
            <div
              className={cn(
                "rounded-md border px-2 py-1 text-left transition-colors",
                selectedTurnId === null
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
              )}
            >
              <div className="text-[10px] leading-tight font-medium">
                {shouldUseCompactMobileHeader ? "All" : "All turns"}
              </div>
            </div>
          </button>
          {orderedTurnDiffSummaries.map((summary) => (
            <button
              key={summary.turnId}
              type="button"
              className="shrink-0 rounded-md"
              onClick={() => selectTurn(summary.turnId)}
              title={summary.turnId}
              data-turn-chip-selected={summary.turnId === selectedTurn?.turnId}
            >
              <div
                className={cn(
                  "rounded-md border px-2 py-1 text-left transition-colors",
                  summary.turnId === selectedTurn?.turnId
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
                )}
              >
                <div className="flex items-center gap-1">
                  <span className="text-[10px] leading-tight font-medium">
                    {shouldUseCompactMobileHeader ? "T" : "Turn"}{" "}
                    {summary.checkpointTurnCount ??
                      inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                      "?"}
                  </span>
                  {!shouldUseCompactMobileHeader && (
                    <span className="text-[9px] leading-tight opacity-70">
                      {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]",
          shouldUseCompactMobileHeader &&
            "rounded-lg border border-border/80 bg-popover/95 p-1 shadow-lg backdrop-blur-md dark:bg-popover/92",
        )}
      >
        <ToggleGroup
          className="shrink-0"
          variant={shouldUseCompactMobileHeader ? "default" : "outline"}
          size="xs"
          value={[diffRenderMode]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "stacked" || next === "split") {
              setDiffRenderMode(next);
            }
          }}
        >
          <Toggle aria-label="Stacked diff view" value="stacked">
            <Rows3Icon className="size-3" />
          </Toggle>
          <Toggle aria-label="Split diff view" value="split">
            <Columns2Icon className="size-3" />
          </Toggle>
        </ToggleGroup>
        {variant === "compact" && routeThreadId && (
          <Button
            type="button"
            size="sm"
            variant={shouldUseCompactMobileHeader ? "ghost" : "outline"}
            className={cn("h-7 shrink-0", shouldUseCompactMobileHeader ? "px-1.5" : "px-2")}
            onClick={openFullDiff}
            aria-label="Open full diff view"
          >
            {shouldUseCompactMobileHeader ? <Maximize2Icon className="size-3.5" /> : "Full diff"}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant={shouldUseCompactMobileHeader ? "ghost" : "outline"}
          className={cn(
            "h-7 shrink-0",
            shouldUseCompactMobileHeader ? "gap-0 px-1.5" : "gap-1.5 px-2",
          )}
          aria-label="Close diff panel"
          onClick={closeDiff}
        >
          <XIcon className="size-3.5" />
          {!shouldUseCompactMobileHeader && <span>Close</span>}
        </Button>
      </div>
    </>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect turn diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Turn diffs are unavailable because this project is not a git repository.
        </div>
      ) : orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No completed turns yet.
        </div>
      ) : variant === "full" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {showFileTree && (
            <DiffFileTree
              activeFilePath={activeFilePath}
              expandedDirectories={expandedDirectories}
              nodes={fileTreeNodes}
              onOpenInEditor={openDiffFileInEditor}
              onSelectFile={selectFile}
              onToggleDirectory={toggleDirectory}
              {...(shouldCollapseFileTreeOnMobile
                ? {
                    onToggleVisibility: () => setIsMobileFileTreeOpen(false),
                    showVisibilityToggle: true,
                  }
                : {})}
            />
          )}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {shouldCollapseFileTreeOnMobile &&
              renderablePatch?.kind === "files" &&
              !showFileTree && (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="absolute left-5 top-3 z-10 size-8 border-border/90 bg-popover/95 text-foreground shadow-lg backdrop-blur-md dark:bg-popover/92"
                  aria-label="Show files"
                  onClick={() => setIsMobileFileTreeOpen(true)}
                >
                  <PanelLeftIcon className="size-4" />
                </Button>
              )}
            <div
              ref={patchViewportRef}
              className="diff-panel-viewport flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            >
              {checkpointDiffError && !renderablePatch && (
                <div className="px-3">
                  <p className="mb-2 text-[11px] text-red-500/80">{checkpointDiffError}</p>
                </div>
              )}
              {!renderablePatch ? (
                isLoadingCheckpointDiff ? (
                  <DiffPanelLoadingState label="Loading checkpoint diff..." />
                ) : (
                  <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                    <p>
                      {hasNoNetChanges
                        ? "No net changes in this selection."
                        : "No patch available for this selection."}
                    </p>
                  </div>
                )
              ) : renderablePatch.kind === "files" ? (
                <Virtualizer
                  className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
                  config={{
                    overscrollSize: 600,
                    intersectionObserverMargin: 1200,
                  }}
                >
                  <div
                    className="diff-render-canvas min-w-full w-max"
                    data-diff-render-mode={diffRenderMode}
                  >
                    {visibleFileDiffs.map((fileDiff) => {
                      const filePath = resolveFileDiffPath(fileDiff);
                      const fileKey = buildFileDiffRenderKey(fileDiff);
                      const themedFileKey = `${fileKey}:${resolvedTheme}`;
                      return (
                        <div
                          key={themedFileKey}
                          data-diff-file-path={filePath}
                          className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
                          onClickCapture={(event) => {
                            const nativeEvent = event.nativeEvent as MouseEvent;
                            const composedPath = nativeEvent.composedPath?.() ?? [];
                            const clickedHeader = composedPath.some((node) => {
                              if (!(node instanceof Element)) return false;
                              return node.hasAttribute("data-title");
                            });
                            if (!clickedHeader) return;
                            openDiffFileInEditor(filePath);
                          }}
                        >
                          <FileDiff
                            fileDiff={fileDiff}
                            options={{
                              diffStyle: diffRenderMode === "split" ? "split" : "unified",
                              lineDiffType: "none",
                              theme: resolveDiffThemeName(resolvedTheme),
                              themeType: resolvedTheme as DiffThemeType,
                              unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </Virtualizer>
              ) : (
                <div className="diff-raw-surface h-full overflow-auto p-2">
                  <div className="diff-render-canvas min-w-full w-max space-y-2">
                    <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                    <pre className="max-h-[72vh] min-w-[48rem] overflow-auto rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90 max-md:min-w-[42rem]">
                      {renderablePatch.text}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={patchViewportRef}
          className="diff-panel-viewport flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {checkpointDiffError && !renderablePatch && (
            <div className="px-3">
              <p className="mb-2 text-[11px] text-red-500/80">{checkpointDiffError}</p>
            </div>
          )}
          {!renderablePatch ? (
            isLoadingCheckpointDiff ? (
              <DiffPanelLoadingState label="Loading checkpoint diff..." />
            ) : (
              <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                <p>
                  {hasNoNetChanges
                    ? "No net changes in this selection."
                    : "No patch available for this selection."}
                </p>
              </div>
            )
          ) : renderablePatch.kind === "files" ? (
            <Virtualizer
              className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
              config={{
                overscrollSize: 600,
                intersectionObserverMargin: 1200,
              }}
            >
              {visibleFileDiffs.map((fileDiff) => {
                const filePath = resolveFileDiffPath(fileDiff);
                const fileKey = buildFileDiffRenderKey(fileDiff);
                const themedFileKey = `${fileKey}:${resolvedTheme}`;
                return (
                  <div
                    key={themedFileKey}
                    data-diff-file-path={filePath}
                    className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
                    onClickCapture={(event) => {
                      const nativeEvent = event.nativeEvent as MouseEvent;
                      const composedPath = nativeEvent.composedPath?.() ?? [];
                      const clickedHeader = composedPath.some((node) => {
                        if (!(node instanceof Element)) return false;
                        return node.hasAttribute("data-title");
                      });
                      if (!clickedHeader) return;
                      openDiffFileInEditor(filePath);
                    }}
                  >
                    <FileDiff
                      fileDiff={fileDiff}
                      options={{
                        diffStyle: diffRenderMode === "split" ? "split" : "unified",
                        lineDiffType: "none",
                        theme: resolveDiffThemeName(resolvedTheme),
                        themeType: resolvedTheme as DiffThemeType,
                        unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                      }}
                    />
                  </div>
                );
              })}
            </Virtualizer>
          ) : (
            <div className="diff-raw-surface h-full overflow-auto p-2">
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                <pre className="max-h-[72vh] overflow-auto rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90">
                  {renderablePatch.text}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </DiffPanelShell>
  );
}
