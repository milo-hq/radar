import type { Pool } from "pg";
export async function reserveDiscoverySlot(
  db: Pool,
  source: string,
): Promise<Date | null> {
  const reserved = await db.query(
    "UPDATE sources SET discovery_available_at=now()+interval '35 seconds' WHERE id=$1 AND (discovery_available_at IS NULL OR discovery_available_at<=now()) RETURNING id",
    [source],
  );
  if (reserved.rowCount) return null;
  const row = (
    await db.query("SELECT discovery_available_at FROM sources WHERE id=$1", [
      source,
    ])
  ).rows[0];
  if (!row) throw Error("未知主题渠道");
  return row.discovery_available_at;
}
