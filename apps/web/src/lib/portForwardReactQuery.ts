import type { PortForwardListInput } from "@t3tools/contracts";

export const portForwardQueryKeys = {
  all: ["portForwards"] as const,
  list: (input?: PortForwardListInput) =>
    ["portForwards", "list", input?.targetId ?? null, input?.threadId ?? null] as const,
};

export function portForwardListQueryOptions(input: PortForwardListInput = {}) {
  return {
    queryKey: portForwardQueryKeys.list(input),
    queryFn: async () => {
      const { ensureNativeApi } = await import("../nativeApi");
      return ensureNativeApi().portForward.list(input);
    },
  };
}
