import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const projectColumns = yield* sql<{ name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  const hasTargetId = projectColumns.some((column) => column.name === "target_id");

  if (!hasTargetId) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN target_id TEXT NOT NULL DEFAULT 'local'
    `;
  }

  yield* sql`
    UPDATE projection_projects
    SET target_id = 'local'
    WHERE target_id IS NULL OR TRIM(target_id) = ''
  `;
});
