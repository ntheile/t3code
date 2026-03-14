import { Client, type ClientChannel, type ConnectConfig } from "ssh2";

import { buildRemoteShellScript, shellQuote, type SshConnectionSpec } from "../executionTarget/ssh";
import type { PtyExitEvent, PtyProcess } from "./Services/PTY";

const SSH_READY_TIMEOUT_MS = 15_000;
const SSH_KEEPALIVE_INTERVAL_MS = 10_000;
const SSH_KEEPALIVE_COUNT_MAX = 3;

let nextSyntheticPid = Math.max(process.pid + 1, 1_000_000);

export interface SshTerminalProcessInput {
  readonly connection: SshConnectionSpec;
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  readonly env?: Record<string, string> | null;
}

function nextSshTerminalPid(): number {
  return nextSyntheticPid++;
}

function resolveSshUsername(connection: SshConnectionSpec): string | undefined {
  return connection.user ?? process.env.USER ?? process.env.LOGNAME;
}

function normalizeSignal(signal: string | undefined): string | null {
  if (!signal) return null;
  const normalized = signal.trim().toUpperCase().replace(/^SIG/, "");
  return normalized.length > 0 ? normalized : null;
}

export function buildRemoteInteractiveShellCommand(): string {
  return [
    'if [ -n "${SHELL:-}" ]; then exec "$SHELL" -l;',
    "elif command -v bash >/dev/null 2>&1; then exec bash -l;",
    "else exec sh -l;",
    "fi",
  ].join(" ");
}

function buildRemoteTerminalCommand(input: SshTerminalProcessInput): string {
  const remoteScript = buildRemoteShellScript({
    cwd: input.cwd,
    ...(input.env ? { env: input.env } : {}),
    command: buildRemoteInteractiveShellCommand(),
  });
  return `sh -lc ${shellQuote(remoteScript)}`;
}

function buildSshConnectConfig(connection: SshConnectionSpec): ConnectConfig {
  const username = resolveSshUsername(connection);
  return {
    host: connection.host,
    ...(connection.port !== undefined ? { port: connection.port } : {}),
    ...(username ? { username } : {}),
    ...(connection.password !== undefined ? { password: connection.password } : {}),
    ...(connection.password !== undefined
      ? {
          tryKeyboard: true,
          authHandler: ["password", "keyboard-interactive"] as const,
        }
      : {}),
    readyTimeout: SSH_READY_TIMEOUT_MS,
    keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
    keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
  };
}

class SshTerminalProcess implements PtyProcess {
  readonly pid = nextSshTerminalPid();
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyExitEvent) => void>();
  private exitEvent: PtyExitEvent | null = null;
  private didExit = false;

  constructor(
    private readonly client: Client,
    private readonly channel: ClientChannel,
  ) {
    this.channel.on("data", (chunk: Buffer | string) => {
      this.emitData(chunk);
    });
    this.channel.stderr.on("data", (chunk: Buffer | string) => {
      this.emitData(chunk);
    });
    this.channel.on("exit", (...args: unknown[]) => {
      const [codeOrNull, signal] = args;
      if (typeof codeOrNull === "number") {
        this.exitEvent = {
          exitCode: codeOrNull,
          signal: typeof signal === "number" ? signal : null,
        };
        return;
      }

      this.exitEvent = {
        exitCode: 255,
        signal: null,
      };
    });
    this.channel.on("close", () => {
      this.emitExit(this.exitEvent ?? { exitCode: 0, signal: null });
      this.client.end();
    });
    this.channel.on("error", (error: Error) => {
      this.emitData(`${error.message}\r\n`);
      this.exitEvent ??= { exitCode: 255, signal: null };
    });
    this.client.on("error", (error: Error) => {
      if (this.didExit) return;
      this.emitData(`${error.message}\r\n`);
      this.exitEvent ??= { exitCode: 255, signal: null };
    });
    this.client.on("close", () => {
      this.emitExit(this.exitEvent ?? { exitCode: 255, signal: null });
    });
  }

  write(data: string): void {
    if (this.didExit) return;
    this.channel.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.didExit) return;
    this.channel.setWindow(rows, cols, 0, 0);
  }

  kill(signal?: string): void {
    if (this.didExit) return;

    const normalizedSignal = normalizeSignal(signal);
    if (normalizedSignal) {
      try {
        this.channel.signal(normalizedSignal);
      } catch {
        // Best-effort signal delivery; we still close the channel below.
      }
    }

    try {
      this.channel.end();
    } catch {
      // Ignore close races during shutdown.
    }

    if (signal === "SIGKILL") {
      this.channel.close();
      this.client.destroy();
      return;
    }

    this.client.end();
  }

  onData(callback: (data: string) => void): () => void {
    this.dataListeners.add(callback);
    return () => {
      this.dataListeners.delete(callback);
    };
  }

  onExit(callback: (event: PtyExitEvent) => void): () => void {
    this.exitListeners.add(callback);
    return () => {
      this.exitListeners.delete(callback);
    };
  }

  private emitData(chunk: Buffer | string): void {
    if (this.didExit) return;
    const data = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (data.length === 0) return;
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  private emitExit(event: PtyExitEvent): void {
    if (this.didExit) return;
    this.didExit = true;
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

export async function createSshTerminalProcess(
  input: SshTerminalProcessInput,
): Promise<PtyProcess> {
  const client = new Client();
  const terminalCommand = buildRemoteTerminalCommand(input);

  return await new Promise<PtyProcess>((resolve, reject) => {
    let settled = false;

    const rejectStartup = (error: unknown) => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    client.once("ready", () => {
      client.exec(
        terminalCommand,
        {
          pty: {
            term: process.platform === "win32" ? "xterm-color" : "xterm-256color",
            cols: input.cols,
            rows: input.rows,
          },
        },
        (error, channel) => {
          if (error) {
            rejectStartup(error);
            return;
          }
          if (settled) {
            channel.close();
            return;
          }
          settled = true;
          resolve(new SshTerminalProcess(client, channel));
        },
      );
    });

    client.once("error", (error) => {
      rejectStartup(error);
    });
    client.once("close", () => {
      rejectStartup(new Error("SSH connection closed before terminal startup completed."));
    });

    if (input.connection.password !== undefined) {
      client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
        finish(prompts.map(() => input.connection.password ?? ""));
      });
    }

    client.connect(buildSshConnectConfig(input.connection));
  });
}
