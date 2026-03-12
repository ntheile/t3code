import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";

import {
  type ExecutionTarget,
  PortForwardCloseInput,
  PortForwardEvent,
  PortForwardListInput,
  PortForwardOpenInput,
  type PortForwardSession,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { createLogger } from "../../logger";
import { ExecutionTargetService } from "../../executionTarget/Services/ExecutionTargetService";
import { buildSshDestination, buildSshEnv } from "../../executionTarget/ssh";
import {
  PortForwardError,
  PortForwardManager,
  type PortForwardManagerShape,
} from "../Services/PortForwardManager";

const decodeOpenInput = Schema.decodeUnknownSync(PortForwardOpenInput);
const decodeListInput = Schema.decodeUnknownSync(PortForwardListInput);
const decodeCloseInput = Schema.decodeUnknownSync(PortForwardCloseInput);

interface PortForwardEvents {
  event: [event: PortForwardEvent];
}

interface PortForwardState {
  session: PortForwardSession;
  child: ChildProcess | null;
  closing: boolean;
  stderr: string;
}

async function reserveLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate a local port.")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForLocalListener(port: number, child: ChildProcess): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      fn();
    };

    const onExit = () => {
      finish(() => reject(new Error("SSH tunnel exited before the local port became ready.")));
    };

    const poll = () => {
      if (Date.now() - startedAt > 1_500) {
        finish(() => reject(new Error("Timed out waiting for local tunnel readiness.")));
        return;
      }

      const socket = net.connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        finish(resolve);
      });
      socket.once("error", () => {
        socket.destroy();
        setTimeout(poll, 50);
      });
    };

    child.once("exit", onExit);
    poll();
  });
}

function buildPortForwardUrl(session: PortForwardSession): string | undefined {
  if (session.protocolHint === "http" || session.protocolHint === "https") {
    return `${session.protocolHint}://127.0.0.1:${session.localPort}`;
  }
  return undefined;
}

class PortForwardManagerRuntime extends EventEmitter<PortForwardEvents> {
  private readonly sessions = new Map<string, PortForwardState>();
  private readonly logger = createLogger("port-forward");

  constructor(
    private readonly getTargetById: (
      targetId: PortForwardOpenInput["targetId"],
    ) => Promise<ExecutionTarget>,
  ) {
    super();
  }

  async open(raw: PortForwardOpenInput): Promise<PortForwardSession> {
    const input = decodeOpenInput(raw);
    const target = await this.getTargetById(input.targetId);
    const createdAt = new Date().toISOString();
    const localPort =
      input.localPort ??
      (target.connection.kind === "local" ? input.remotePort : await reserveLocalPort());
    const session: PortForwardSession = {
      id: randomUUID(),
      targetId: input.targetId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      remoteHost: input.remoteHost ?? "127.0.0.1",
      remotePort: input.remotePort,
      localPort,
      ...(input.protocolHint ? { protocolHint: input.protocolHint } : {}),
      ...(input.label ? { label: input.label } : {}),
      status: "starting",
      createdAt,
      updatedAt: createdAt,
    };

    if (target.connection.kind === "local") {
      const runningSession = {
        ...session,
        status: "running" as const,
        updatedAt: new Date().toISOString(),
        ...(buildPortForwardUrl({ ...session, status: "running" })
          ? { url: buildPortForwardUrl({ ...session, status: "running" }) }
          : {}),
      };
      this.sessions.set(runningSession.id, {
        session: runningSession,
        child: null,
        closing: false,
        stderr: "",
      });
      this.emit("event", {
        type: "opened",
        id: runningSession.id,
        targetId: runningSession.targetId,
        createdAt: runningSession.updatedAt,
        session: runningSession,
      });
      return runningSession;
    }

    if (target.connection.kind !== "ssh") {
      throw new Error(`Port forwarding is not implemented for target '${target.label}'.`);
    }

    const args = [
      ...(target.connection.port !== undefined ? ["-p", String(target.connection.port)] : []),
      "-N",
      "-o",
      "ExitOnForwardFailure=yes",
      "-L",
      `127.0.0.1:${localPort}:${input.remoteHost ?? "127.0.0.1"}:${input.remotePort}`,
      buildSshDestination({
        host: target.connection.host,
        ...(target.connection.port !== undefined ? { port: target.connection.port } : {}),
        ...(target.connection.user !== undefined ? { user: target.connection.user } : {}),
      }),
    ];

    const child = spawn("ssh", args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: buildSshEnv({
        connection: {
          host: target.connection.host,
          ...(target.connection.port !== undefined ? { port: target.connection.port } : {}),
          ...(target.connection.user !== undefined ? { user: target.connection.user } : {}),
          ...(target.connection.password !== undefined
            ? { password: target.connection.password }
            : {}),
        },
        env: process.env,
      }),
    });
    child.stderr?.setEncoding("utf8");

    const state: PortForwardState = {
      session,
      child,
      closing: false,
      stderr: "",
    };
    this.sessions.set(session.id, state);

    child.stderr?.on("data", (chunk: string) => {
      state.stderr = `${state.stderr}${chunk}`.slice(-8_192);
    });
    child.once("exit", () => {
      const current = this.sessions.get(session.id);
      if (!current) {
        return;
      }
      if (current.closing) {
        return;
      }
      this.sessions.delete(session.id);
      const message = current.stderr.trim() || "SSH tunnel exited unexpectedly.";
      this.logger.warn("port forward exited", {
        id: current.session.id,
        targetId: current.session.targetId,
        localPort: current.session.localPort,
        remotePort: current.session.remotePort,
        error: message,
      });
      this.emit("event", {
        type: "error",
        id: current.session.id,
        targetId: current.session.targetId,
        createdAt: new Date().toISOString(),
        message,
      });
    });

    try {
      await waitForLocalListener(localPort, child);
    } catch (error) {
      state.closing = true;
      child.kill("SIGTERM");
      this.sessions.delete(session.id);
      throw error;
    }

    const runningSession: PortForwardSession = {
      ...session,
      status: "running",
      updatedAt: new Date().toISOString(),
      ...(buildPortForwardUrl({ ...session, status: "running" })
        ? { url: buildPortForwardUrl({ ...session, status: "running" }) }
        : {}),
    };
    state.session = runningSession;
    this.emit("event", {
      type: "opened",
      id: runningSession.id,
      targetId: runningSession.targetId,
      createdAt: runningSession.updatedAt,
      session: runningSession,
    });
    return runningSession;
  }

  async list(raw: PortForwardListInput = {}): Promise<ReadonlyArray<PortForwardSession>> {
    const input = decodeListInput(raw);
    return [...this.sessions.values()]
      .map((state) => state.session)
      .filter((session) => {
        if (input.targetId && session.targetId !== input.targetId) return false;
        if (input.threadId && session.threadId !== input.threadId) return false;
        return true;
      })
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async close(raw: PortForwardCloseInput): Promise<void> {
    const input = decodeCloseInput(raw);
    const state = this.sessions.get(input.id);
    if (!state) {
      return;
    }
    state.closing = true;
    this.sessions.delete(input.id);
    if (state.child) {
      state.child.kill("SIGTERM");
    }
    this.emit("event", {
      type: "closed",
      id: state.session.id,
      targetId: state.session.targetId,
      createdAt: new Date().toISOString(),
    });
  }

  dispose(): void {
    for (const state of this.sessions.values()) {
      state.closing = true;
      state.child?.kill("SIGTERM");
    }
    this.sessions.clear();
  }
}

export const PortForwardManagerLive = Layer.effect(
  PortForwardManager,
  Effect.gen(function* () {
    const executionTargets = yield* ExecutionTargetService;
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new PortForwardManagerRuntime((targetId) =>
            Effect.runPromise(executionTargets.getByIdForRuntime(targetId)),
          ),
      ),
      (manager) => Effect.sync(() => manager.dispose()),
    );

    return {
      open: (input) =>
        Effect.tryPromise({
          try: () => runtime.open(input),
          catch: (cause) => new PortForwardError({ message: "Failed to open port forward", cause }),
        }),
      list: (input) =>
        Effect.tryPromise({
          try: () => runtime.list(input),
          catch: (cause) =>
            new PortForwardError({ message: "Failed to list port forwards", cause }),
        }),
      close: (input) =>
        Effect.tryPromise({
          try: () => runtime.close(input),
          catch: (cause) =>
            new PortForwardError({ message: "Failed to close port forward", cause }),
        }),
      subscribe: (listener) =>
        Effect.sync(() => {
          runtime.on("event", listener);
          return () => {
            runtime.off("event", listener);
          };
        }),
      dispose: Effect.sync(() => runtime.dispose()),
    } satisfies PortForwardManagerShape;
  }),
);
