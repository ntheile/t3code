import type { CodexCliSshLaunchSpec } from "../../codexAppServerManager";
import type { ProviderSession, ProviderSessionStartInput } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class ExecutionTargetRuntimeError extends Schema.TaggedErrorClass<ExecutionTargetRuntimeError>()(
  "ExecutionTargetRuntimeError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface ExecutionTargetRuntimeShape {
  readonly startProviderSession: (
    input: ProviderSessionStartInput,
    handlers: {
      readonly startLocal: (input: ProviderSessionStartInput) => Promise<ProviderSession>;
      readonly startSsh: (
        input: ProviderSessionStartInput,
        ssh: CodexCliSshLaunchSpec,
      ) => Promise<ProviderSession>;
    },
  ) => Effect.Effect<ProviderSession, ExecutionTargetRuntimeError>;
}

export class ExecutionTargetRuntime extends ServiceMap.Service<
  ExecutionTargetRuntime,
  ExecutionTargetRuntimeShape
>()("t3/executionTarget/Services/ExecutionTargetRuntime") {}
