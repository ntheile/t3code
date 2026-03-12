import { Effect, Layer } from "effect";

import { runProcess } from "../../processRunner";
import { makeGitHubCliShape, normalizeGitHubCliError, GitHubCli } from "../makeGitHubCli.ts";
import type { GitHubCliShape } from "../Services/GitHubCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

const makeGitHubCli = Effect.sync(() => {
  const execute: GitHubCliShape["execute"] = (input) =>
    Effect.tryPromise({
      try: () =>
        runProcess("gh", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
        }),
      catch: (error) => normalizeGitHubCliError("execute", error),
    });
  return makeGitHubCliShape(execute);
});

export const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli);
