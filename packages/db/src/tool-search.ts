import { globalPolicy } from "../../core/src/discovery-policy.js";
import type { PoolClient } from "pg";
// Seed discovery targets, not claims that these products have unresolved defects.
const catalog = [
  ["Notion", "export"],
  ["Airtable", "pricing"],
  ["Calendly", "integration"],
  ["Mailchimp", "alternative"],
  ["ClickUp", "slow"],
  ["Trello", "automation"],
  ["Typeform", "pricing"],
  ["Todoist", "missing"],
  ["Zapier", "pricing"],
  ["Obsidian", "sync"],
  ["Buffer", "scheduling"],
  ["Screen Studio", "alternative"],
] as const;
export type ToolTarget = { product: string; focus: string };
export function toolTargets(round: number): ToolTarget[] {
  return Array.from({ length: 4 }, (_, i) => {
    const [product, focus] =
      catalog[(Math.max(0, Math.floor(round)) * 4 + i) % catalog.length];
    return { product, focus };
  });
}
export function productQuery(
  t: ToolTarget,
  source: "x" | "reddit" | "general",
) {
  if (source === "general") return `${t.product} ${t.focus}`;
  return `"${t.product}" (${t.focus} OR "alternative" OR "missing" OR "frustrating")${source === "x" ? " -filter:retweets" : ""}`;
}
export async function ensureToolTargets(
  c: PoolClient,
  scanId?: string,
): Promise<ToolTarget[]> {
  if (!scanId) return toolTargets(0);
  const row = (
    await c.query("SELECT plan FROM radar_scans WHERE id=$1 FOR UPDATE", [
      scanId,
    ])
  ).rows[0];
  if (!row) throw Error("Scan not found");
  if (row.plan.toolTargets) return row.plan.toolTargets;
  const round = Number(
    (
      await c.query(
        "SELECT count(*) n FROM radar_scans WHERE plan ? 'toolTargets' AND id<>$1",
        [scanId],
      )
    ).rows[0].n,
  );
  const targets = toolTargets(round);
  await c.query("UPDATE radar_scans SET plan=plan||$2::jsonb WHERE id=$1", [
    scanId,
    JSON.stringify({ toolTargets: targets, policy: globalPolicy(round) }),
  ]);
  return targets;
}
