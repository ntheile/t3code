import { queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const executionTargetQueryKeys = {
  all: ["executionTargets"] as const,
  list: () => ["executionTargets", "list"] as const,
};

export function executionTargetListQueryOptions() {
  return queryOptions({
    queryKey: executionTargetQueryKeys.list(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listExecutionTargets();
    },
  });
}
