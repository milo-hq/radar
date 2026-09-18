/** Re-run saved evidence as a separate, traceable scan; never refetch or replace history. */
import { z } from "zod";
import { pool, transaction } from "../packages/db/src/index.js";
import { enqueue } from "../packages/db/src/jobs.js";
import { selectDocuments } from "../packages/radar/src/radar.js";
const original = z.uuid().parse(process.argv[2]);
try {
  const result = await transaction(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "reanalysis:context-v2:" + original,
    ]);
    const existing = (
      await c.query(
        "SELECT id,status FROM radar_scans WHERE plan->>'reanalysisOf'=$1 AND plan->>'evidencePolicy'='context-v2' ORDER BY created_at DESC LIMIT 1",
        [original],
      )
    ).rows[0];
    if (existing) return existing;
    const source = (
      await c.query(
        "SELECT * FROM radar_scans WHERE id=$1 AND status='complete'",
        [original],
      )
    ).rows[0];
    if (!source) throw Error("Original completed scan not found");
    const docs = (
      await c.query(
        "SELECT DISTINCT d.* FROM discovery_documents dd JOIN jobs j ON j.id=dd.job_id JOIN raw_documents d ON d.id=dd.document_id WHERE j.payload->>'scanId'=$1 ORDER BY d.collected_at DESC",
        [original],
      )
    ).rows;
    const { eligible, coverage } = selectDocuments(docs);
    if (!eligible.length) throw Error("No saved evidence to reanalyze");
    const scan = (
      await c.query(
        "INSERT INTO radar_scans(status,plan,coverage) VALUES('analyzing',$1,$2) RETURNING id,status",
        [
          JSON.stringify({
            reanalysisOf: original,
            evidencePolicy: "context-v2",
            note: "使用历史原文重新分析，没有新增采集",
          }),
          JSON.stringify(coverage),
        ],
      )
    ).rows[0];
    await enqueue(
      c,
      "RADAR_ANALYZE",
      { scanId: scan.id, documentIds: eligible.map((d) => d.id) },
      `radar-analyze:${scan.id}`,
    );
    return scan;
  });
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
