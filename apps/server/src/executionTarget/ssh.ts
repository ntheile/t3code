import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SshConnectionSpec {
  readonly host: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
}

const SSH_ASKPASS_ENV_KEY = "T3CODE_SSH_PASSWORD";
const SSH_ASKPASS_SCRIPT_PATH = path.join(os.tmpdir(), "t3code-ssh-askpass");
const SSH_ASKPASS_SCRIPT_CONTENT = `#!/usr/bin/env node
process.stdout.write(String(process.env.${SSH_ASKPASS_ENV_KEY} ?? "") + "\\n");
`;

function ensureSshAskpassScriptPath(): string {
  const existing = fs.existsSync(SSH_ASKPASS_SCRIPT_PATH)
    ? fs.readFileSync(SSH_ASKPASS_SCRIPT_PATH, "utf8")
    : null;
  if (existing !== SSH_ASKPASS_SCRIPT_CONTENT) {
    fs.writeFileSync(SSH_ASKPASS_SCRIPT_PATH, SSH_ASKPASS_SCRIPT_CONTENT, {
      mode: 0o700,
    });
    fs.chmodSync(SSH_ASKPASS_SCRIPT_PATH, 0o700);
  }
  return SSH_ASKPASS_SCRIPT_PATH;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildSshDestination(input: SshConnectionSpec): string {
  return input.user ? `${input.user}@${input.host}` : input.host;
}

export function buildRemoteShellScript(input: {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly command: string;
}): string {
  const steps: string[] = [];

  if (input.cwd) {
    steps.push(`cd ${shellQuote(input.cwd)}`);
  }

  if (input.env) {
    for (const [key, value] of Object.entries(input.env).toSorted(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (value === undefined) continue;
      steps.push(`export ${key}=${shellQuote(value)}`);
    }
  }

  steps.push(input.command);
  return steps.join(" && ");
}

export function buildSshEnv(input: {
  readonly connection: SshConnectionSpec;
  readonly env?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const baseEnv = { ...(input.env ?? process.env) };
  if (!input.connection.password) {
    return baseEnv;
  }

  return {
    ...baseEnv,
    DISPLAY: baseEnv.DISPLAY ?? "t3code:0",
    SSH_ASKPASS: ensureSshAskpassScriptPath(),
    SSH_ASKPASS_REQUIRE: "force",
    [SSH_ASKPASS_ENV_KEY]: input.connection.password,
  };
}

export function buildSshCommand(input: {
  readonly connection: SshConnectionSpec;
  readonly remoteScript: string;
  readonly allocateTty?: boolean;
  readonly env?: NodeJS.ProcessEnv;
}): { readonly command: string; readonly args: string[]; readonly env: NodeJS.ProcessEnv } {
  const shouldUseBatchMode = input.allocateTty !== true && !input.connection.password;
  return {
    command: "ssh",
    args: [
      ...(shouldUseBatchMode ? ["-o", "BatchMode=yes"] : []),
      ...(input.connection.password
        ? [
            "-o",
            "BatchMode=no",
            "-o",
            "NumberOfPasswordPrompts=1",
            "-o",
            "PreferredAuthentications=password,keyboard-interactive",
            "-o",
            "PubkeyAuthentication=no",
          ]
        : []),
      ...(input.connection.port !== undefined ? ["-p", String(input.connection.port)] : []),
      ...(input.allocateTty === true ? ["-tt"] : []),
      buildSshDestination(input.connection),
      "sh",
      "-lc",
      shellQuote(input.remoteScript),
    ],
    env: buildSshEnv({
      connection: input.connection,
      ...(input.env ? { env: input.env } : {}),
    }),
  };
}
