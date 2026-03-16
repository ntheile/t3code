import {
  ExecutionTarget,
  ExecutionTargetHealth,
  ExecutionTargetId,
  IsoDateTime,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const PersistedExecutionTarget = Schema.Struct({
  id: ExecutionTarget.fields.id,
  kind: ExecutionTarget.fields.kind,
  label: ExecutionTarget.fields.label,
  connection: ExecutionTarget.fields.connection,
  capabilities: ExecutionTarget.fields.capabilities,
  health: Schema.NullOr(ExecutionTargetHealth),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PersistedExecutionTarget = typeof PersistedExecutionTarget.Type;

export const GetPersistedExecutionTargetInput = Schema.Struct({
  targetId: ExecutionTargetId,
});
export type GetPersistedExecutionTargetInput = typeof GetPersistedExecutionTargetInput.Type;

export const DeletePersistedExecutionTargetInput = Schema.Struct({
  targetId: ExecutionTargetId,
});
export type DeletePersistedExecutionTargetInput = typeof DeletePersistedExecutionTargetInput.Type;

export interface ExecutionTargetRepositoryShape {
  readonly upsert: (
    row: PersistedExecutionTarget,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetPersistedExecutionTargetInput,
  ) => Effect.Effect<Option.Option<PersistedExecutionTarget>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<PersistedExecutionTarget>,
    ProjectionRepositoryError
  >;
  readonly deleteById: (
    input: DeletePersistedExecutionTargetInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ExecutionTargetRepository extends ServiceMap.Service<
  ExecutionTargetRepository,
  ExecutionTargetRepositoryShape
>()("t3/persistence/Services/ExecutionTargets/ExecutionTargetRepository") {}
