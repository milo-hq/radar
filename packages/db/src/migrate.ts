import { readdir, readFile } from "node:fs/promises";
import { pool, transaction } from "./index.js";
try {
  await transaction(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(849301)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
    );
    const files = (await readdir("migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (
        (await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [file]))
          .rowCount
      )
        continue;
      if (
        file.includes(".optional.") &&
        !(
          await c.query(
            "SELECT 1 FROM pg_available_extensions WHERE name='vector'",
          )
        ).rowCount
      ) {
        console.log(
          "pgvector unavailable: raw ingestion enabled; vector layer disabled",
        );
        continue;
      }
      await c.query(await readFile(`migrations/${file}`, "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [file]);
      console.log(`Applied ${file}`);
    }
  });
} finally {
  await pool.end();
}
