import {
  type ExecutionTargetId,
  type PortForwardProtocolHint,
  type ThreadId,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { portForwardListQueryOptions, portForwardQueryKeys } from "../lib/portForwardReactQuery";
import { ensureNativeApi } from "../nativeApi";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface ThreadPortForwardPanelProps {
  threadId: ThreadId;
  targetId: ExecutionTargetId;
}

export default function ThreadPortForwardPanel({
  threadId,
  targetId,
}: ThreadPortForwardPanelProps) {
  const queryClient = useQueryClient();
  const portForwardQuery = useQuery(
    portForwardListQueryOptions({
      threadId,
      targetId,
    }),
  );
  const [remotePort, setRemotePort] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [label, setLabel] = useState("");
  const [protocolHint, setProtocolHint] = useState<PortForwardProtocolHint>("http");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = ensureNativeApi();
    return api.portForward.onEvent(() => {
      void queryClient.invalidateQueries({ queryKey: portForwardQueryKeys.all });
    });
  }, [queryClient]);

  const openMutation = useMutation({
    mutationFn: async () => {
      const parsedRemotePort = Number(remotePort.trim());
      const localPortValue = localPort.trim();
      const parsedLocalPort = localPortValue.length > 0 ? Number(localPortValue) : undefined;

      if (
        !Number.isInteger(parsedRemotePort) ||
        parsedRemotePort < 1 ||
        parsedRemotePort > 65_535
      ) {
        throw new Error("Remote port must be between 1 and 65535.");
      }
      if (
        parsedLocalPort !== undefined &&
        (!Number.isInteger(parsedLocalPort) || parsedLocalPort < 1 || parsedLocalPort > 65_535)
      ) {
        throw new Error("Local port must be between 1 and 65535.");
      }

      return ensureNativeApi().portForward.open({
        threadId,
        targetId,
        remotePort: parsedRemotePort,
        ...(parsedLocalPort !== undefined ? { localPort: parsedLocalPort } : {}),
        ...(label.trim().length > 0 ? { label: label.trim() } : {}),
        protocolHint,
      });
    },
    onSuccess: async () => {
      setRemotePort("");
      setLocalPort("");
      setLabel("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: portForwardQueryKeys.all });
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error ? mutationError.message : "Unable to open port forward.",
      );
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (id: string) => {
      await ensureNativeApi().portForward.close({ id });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: portForwardQueryKeys.all });
    },
  });

  return (
    <section className="border-t border-border/80 bg-muted/10 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-medium text-foreground">Port Forwards</h3>
          <p className="truncate text-[11px] text-muted-foreground">
            Thread target: <span className="font-medium text-foreground">{targetId}</span>
          </p>
        </div>
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-[112px_112px_1fr_96px_auto]">
        <Input
          value={remotePort}
          onChange={(event) => setRemotePort(event.target.value)}
          inputMode="numeric"
          placeholder="Remote port"
        />
        <Input
          value={localPort}
          onChange={(event) => setLocalPort(event.target.value)}
          inputMode="numeric"
          placeholder="Local port"
        />
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label"
        />
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={protocolHint}
          onChange={(event) => setProtocolHint(event.target.value as PortForwardProtocolHint)}
        >
          <option value="http">HTTP</option>
          <option value="https">HTTPS</option>
          <option value="tcp">TCP</option>
        </select>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setError(null);
            openMutation.mutate();
          }}
          disabled={openMutation.isPending}
        >
          Open
        </Button>
      </div>

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {(portForwardQuery.data ?? []).map((forward) => (
          <div
            key={forward.id}
            className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background px-2 py-1.5 text-xs"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">
                {forward.label ?? `${forward.remotePort}`}
              </p>
              <p className="truncate text-muted-foreground">
                127.0.0.1:{forward.localPort} → {forward.remoteHost}:{forward.remotePort}
              </p>
            </div>
            {forward.url ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!forward.url) return;
                  void ensureNativeApi().shell.openExternal(forward.url);
                }}
              >
                Open
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => closeMutation.mutate(forward.id)}
              disabled={closeMutation.isPending}
            >
              Close
            </Button>
          </div>
        ))}
        {portForwardQuery.data?.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active forwards for this thread.</p>
        ) : null}
      </div>
    </section>
  );
}
