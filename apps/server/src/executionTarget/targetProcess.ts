import type { ExecutionTarget } from "@t3tools/contracts";

import { runProcess, type ProcessRunOptions, type ProcessRunResult } from "../processRunner";
import { buildRemoteShellScript, buildSshCommand, shellQuote } from "./ssh";

export async function runTargetProcess(input: {
  readonly target: ExecutionTarget;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly stdin?: string;
  readonly timeoutMs?: number;
  readonly allowNonZeroExit?: boolean;
  readonly maxBufferBytes?: number;
  readonly outputMode?: ProcessRunOptions["outputMode"];
}): Promise<ProcessRunResult> {
  if (input.target.connection.kind === "local") {
    return runProcess(input.command, input.args, {
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.env ? { env: { ...process.env, ...input.env } } : {}),
      ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.allowNonZeroExit !== undefined ? { allowNonZeroExit: input.allowNonZeroExit } : {}),
      ...(input.maxBufferBytes !== undefined ? { maxBufferBytes: input.maxBufferBytes } : {}),
      ...(input.outputMode !== undefined ? { outputMode: input.outputMode } : {}),
    });
  }

  if (input.target.connection.kind !== "ssh") {
    throw new Error(`Command execution is not implemented for target '${input.target.label}'.`);
  }

  const remoteScript = buildRemoteShellScript({
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.env ? { env: input.env } : {}),
    command: `exec ${[input.command, ...input.args].map(shellQuote).join(" ")}`,
  });
  const sshCommand = buildSshCommand({
    connection: {
      host: input.target.connection.host,
      ...(input.target.connection.port !== undefined ? { port: input.target.connection.port } : {}),
      ...(input.target.connection.user !== undefined ? { user: input.target.connection.user } : {}),
      ...(input.target.connection.password !== undefined
        ? { password: input.target.connection.password }
        : {}),
    },
    remoteScript,
  });
  return runProcess(sshCommand.command, sshCommand.args, {
    env: sshCommand.env,
    ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.allowNonZeroExit !== undefined ? { allowNonZeroExit: input.allowNonZeroExit } : {}),
    ...(input.maxBufferBytes !== undefined ? { maxBufferBytes: input.maxBufferBytes } : {}),
    ...(input.outputMode !== undefined ? { outputMode: input.outputMode } : {}),
  });
}
