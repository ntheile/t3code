import {
  ExecutionTarget,
  ExecutionTargetCheckHealthInput,
  ExecutionTargetId,
  ExecutionTargetRemoveInput,
  ExecutionTargetUpsertInput,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class ExecutionTargetServiceError extends Schema.TaggedErrorClass<ExecutionTargetServiceError>()(
  "ExecutionTargetServiceError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface ExecutionTargetServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<ExecutionTarget>, ExecutionTargetServiceError>;
  readonly upsert: (
    input: ExecutionTargetUpsertInput,
  ) => Effect.Effect<ExecutionTarget, ExecutionTargetServiceError>;
  readonly remove: (
    input: ExecutionTargetRemoveInput,
  ) => Effect.Effect<void, ExecutionTargetServiceError>;
  readonly checkHealth: (
    input: ExecutionTargetCheckHealthInput,
  ) => Effect.Effect<ExecutionTarget, ExecutionTargetServiceError>;
  readonly getById: (
    targetId: ExecutionTargetId,
  ) => Effect.Effect<ExecutionTarget, ExecutionTargetServiceError>;
  readonly getByIdForRuntime: (
    targetId: ExecutionTargetId,
  ) => Effect.Effect<ExecutionTarget, ExecutionTargetServiceError>;
}

export class ExecutionTargetService extends ServiceMap.Service<
  ExecutionTargetService,
  ExecutionTargetServiceShape
>()("t3/executionTarget/Services/ExecutionTargetService") {}
