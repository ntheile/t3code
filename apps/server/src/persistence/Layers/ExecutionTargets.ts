import {
  ExecutionTargetCapabilities,
  ExecutionTargetConnection,
  ExecutionTargetHealth,
} from "@t3tools/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeletePersistedExecutionTargetInput,
  ExecutionTargetRepository,
  type ExecutionTargetRepositoryShape,
  GetPersistedExecutionTargetInput,
  PersistedExecutionTarget,
} from "../Services/ExecutionTargets.ts";

const PersistedExecutionTargetDbRow = PersistedExecutionTarget.mapFields(
  Struct.assign({
    connection: Schema.fromJsonString(ExecutionTargetConnection),
    capabilities: Schema.fromJsonString(ExecutionTargetCapabilities),
    health: Schema.NullOr(Schema.fromJsonString(ExecutionTargetHealth)),
  }),
);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeExecutionTargetRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: PersistedExecutionTargetDbRow,
    execute: (row) =>
      sql`
        INSERT INTO execution_targets (
          id,
          kind,
          label,
          connection_json,
          capabilities_json,
          health_json,
          created_at,
          updated_at
        )
        VALUES (
          ${row.id},
          ${row.kind},
          ${row.label},
          ${row.connection},
          ${row.capabilities},
          ${row.health},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (id)
        DO UPDATE SET
          kind = excluded.kind,
          label = excluded.label,
          connection_json = excluded.connection_json,
          capabilities_json = excluded.capabilities_json,
          health_json = excluded.health_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetPersistedExecutionTargetInput,
    Result: PersistedExecutionTargetDbRow,
    execute: ({ targetId }) =>
      sql`
        SELECT
          id,
          kind,
          label,
          connection_json AS "connection",
          capabilities_json AS "capabilities",
          health_json AS "health",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM execution_targets
        WHERE id = ${targetId}
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: PersistedExecutionTargetDbRow,
    execute: () =>
      sql`
        SELECT
          id,
          kind,
          label,
          connection_json AS "connection",
          capabilities_json AS "capabilities",
          health_json AS "health",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM execution_targets
        ORDER BY label ASC, id ASC
      `,
  });

  const deleteRow = SqlSchema.void({
    Request: DeletePersistedExecutionTargetInput,
    execute: ({ targetId }) =>
      sql`
        DELETE FROM execution_targets
        WHERE id = ${targetId}
      `,
  });

  const upsert: ExecutionTargetRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ExecutionTargetRepository.upsert:query",
          "ExecutionTargetRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getById: ExecutionTargetRepositoryShape["getById"] = (input) =>
    getRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ExecutionTargetRepository.getById:query",
          "ExecutionTargetRepository.getById:decodeRow",
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) =>
            Effect.succeed(Option.some(row as Schema.Schema.Type<typeof PersistedExecutionTarget>)),
        }),
      ),
    );

  const listAll: ExecutionTargetRepositoryShape["listAll"] = () =>
    listRows().pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ExecutionTargetRepository.listAll:query",
          "ExecutionTargetRepository.listAll:decodeRows",
        ),
      ),
      Effect.map(
        (rows) => rows as ReadonlyArray<Schema.Schema.Type<typeof PersistedExecutionTarget>>,
      ),
    );

  const deleteById: ExecutionTargetRepositoryShape["deleteById"] = (input) =>
    deleteRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ExecutionTargetRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    deleteById,
  } satisfies ExecutionTargetRepositoryShape;
});

export const ExecutionTargetRepositoryLive = Layer.effect(
  ExecutionTargetRepository,
  makeExecutionTargetRepository,
);
