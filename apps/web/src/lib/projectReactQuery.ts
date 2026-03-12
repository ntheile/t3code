import type {
  ExecutionTargetId,
  ProjectListDirectoryResult,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  listDirectory: (cwd: string | null, targetId: ExecutionTargetId | null) =>
    ["projects", "list-directory", cwd, targetId] as const,
  searchEntries: (
    cwd: string | null,
    targetId: ExecutionTargetId | null,
    query: string,
    limit: number,
  ) => ["projects", "search-entries", cwd, targetId, query, limit] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_LIST_DIRECTORY_RESULT: ProjectListDirectoryResult = {
  cwd: "",
  entries: [],
};

export function projectListDirectoryQueryOptions(input: {
  cwd?: string | null;
  targetId?: ExecutionTargetId | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.listDirectory(input.cwd ?? null, input.targetId ?? null),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.projects.listDirectory({
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.targetId ? { targetId: input.targetId } : {}),
      });
    },
    enabled: input.enabled ?? true,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_LIST_DIRECTORY_RESULT,
  });
}

export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  targetId?: ExecutionTargetId | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.cwd, input.targetId ?? null, input.query, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        ...(input.targetId ? { targetId: input.targetId } : {}),
        query: input.query,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}
