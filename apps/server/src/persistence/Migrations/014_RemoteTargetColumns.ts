import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const DEFAULT_TARGET_ID = "local";

type TableColumnRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const ensureTargetIdColumn = (tableName: string) =>
    Effect.gen(function* () {
      const columns = yield* sql<TableColumnRow>`
        PRAGMA table_info(${sql(tableName)})
      `;

      const hasTargetId = columns.some((column) => column.name === "target_id");
      if (!hasTargetId) {
        yield* sql`
          ALTER TABLE ${sql(tableName)}
          ADD COLUMN target_id TEXT NOT NULL DEFAULT 'local'
        `;
      }

      yield* sql`
        UPDATE ${sql(tableName)}
        SET target_id = ${DEFAULT_TARGET_ID}
        WHERE target_id IS NULL
      `;
    });

  yield* ensureTargetIdColumn("provider_session_runtime");
  yield* ensureTargetIdColumn("projection_threads");
  yield* ensureTargetIdColumn("projection_thread_sessions");
});
