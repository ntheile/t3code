import fs from "node:fs";
import path from "node:path";

import type { ExecutionTargetConnection, ExecutionTargetId } from "@t3tools/contracts";

const SSH_SECRETS_FILE_NAME = "ssh-secrets.env";
const SSH_PASSWORD_ENV_PREFIX = "T3CODE_SSH_PASSWORD_";

function sanitizeEnvToken(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return normalized.length > 0 ? normalized : "TARGET";
}

function encodeEnvValue(value: string): string {
  return JSON.stringify(value);
}

function decodeEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, value.endsWith('"') ? -1 : undefined);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function readEnvFile(filePath: string): Map<string, string> {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  const content = fs.readFileSync(filePath, "utf8");
  const values = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (key.length === 0) {
      continue;
    }

    const value = line.slice(separatorIndex + 1);
    values.set(key, decodeEnvValue(value));
  }

  return values;
}

function writeEnvFile(filePath: string, values: ReadonlyMap<string, string>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [...values.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeEnvValue(value)}`);
  fs.writeFileSync(filePath, `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, "utf8");
}

export function sshSecretsEnvFilePath(stateDir: string): string {
  return path.join(stateDir, SSH_SECRETS_FILE_NAME);
}

export function sshPasswordEnvVarName(targetId: ExecutionTargetId): string {
  return `${SSH_PASSWORD_ENV_PREFIX}${sanitizeEnvToken(targetId)}`;
}

export function storeSshPasswordSecret(input: {
  readonly stateDir: string;
  readonly targetId: ExecutionTargetId;
  readonly password: string;
}): string {
  const envVarName = sshPasswordEnvVarName(input.targetId);
  const filePath = sshSecretsEnvFilePath(input.stateDir);
  const values = readEnvFile(filePath);
  values.set(envVarName, input.password);
  writeEnvFile(filePath, values);
  process.env[envVarName] = input.password;
  return envVarName;
}

export function deleteSshPasswordSecret(input: {
  readonly stateDir: string;
  readonly envVarName: string | undefined;
}): void {
  if (!input.envVarName) {
    return;
  }
  const filePath = sshSecretsEnvFilePath(input.stateDir);
  const values = readEnvFile(filePath);
  if (!values.delete(input.envVarName)) {
    delete process.env[input.envVarName];
    return;
  }
  writeEnvFile(filePath, values);
  delete process.env[input.envVarName];
}

export function resolveSshPasswordSecret(input: {
  readonly stateDir: string;
  readonly connection: Extract<ExecutionTargetConnection, { kind: "ssh" }>;
  readonly targetId?: ExecutionTargetId;
}): string | undefined {
  if (input.connection.password !== undefined) {
    return input.connection.password;
  }

  const envVarName =
    input.connection.passwordEnvVar ??
    (input.targetId ? sshPasswordEnvVarName(input.targetId) : undefined);
  if (!envVarName) {
    return undefined;
  }

  const envValue = process.env[envVarName];
  if (envValue !== undefined) {
    return envValue;
  }

  const filePath = sshSecretsEnvFilePath(input.stateDir);
  return readEnvFile(filePath).get(envVarName);
}

export function stripSshPasswordSecret(
  connection: Extract<ExecutionTargetConnection, { kind: "ssh" }>,
): Extract<ExecutionTargetConnection, { kind: "ssh" }> {
  const { password: _password, ...rest } = connection;
  return rest;
}
