import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const projectColumns = yield* sql<{ name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  const hasColor = projectColumns.some((column) => column.name === "color");

  if (!hasColor) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN color TEXT DEFAULT NULL
    `;
  }
});
