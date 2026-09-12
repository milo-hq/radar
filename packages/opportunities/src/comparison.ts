import { z } from "zod";
import type { Pool } from "pg";
import type { LLMProvider } from "../../llm/src/provider.js";
import { runStructured } from "../../llm/src/run.js";
import { transaction } from "../../db/src/index.js";
import { hash } from "../../core/src/documents.js";
import { getOpportunity } from "./service.js";
export const weights = {
  demand: 25,
  value: 25,
  feasibility: 20,
  acquisition: 15,
  fit: 15,
};
export function comparisonScore(scores: Record<string, number | null>) {
  let total = 0,
    coverage = 0,
    known = 0;
  for (const [key, weight] of Object.entries(weights))
    if (scores[key] != null) {
      total += scores[key] * weight;
      coverage += weight;
      known++;
    }
  return {
    score:
      coverage >= 60 && known >= 3
        ? Math.round((total / coverage) * 10) / 10
        : null,
    coverage,
  };
}
export async function comparisonInput(db: Pool, enforceLimit = false) {
  const ids = (
    await db.query(
      "SELECT id FROM opportunities WHERE status!='KILL' ORDER BY id",
    )
  ).rows;
  if (enforceLimit && ids.length > 30)
    throw Object.assign(
      Error("当前比较支持最多30条未放弃机会，请先筛选并放弃不相关草稿"),
      { statusCode: 400 },
    );
  const founder =
    (await db.query("SELECT profile FROM founder_profiles WHERE id=1")).rows[0]
      ?.profile ?? {};
  const items = await Promise.all(
    ids.map(async ({ id }) => {
      const o = await getOpportunity(db, id);
      return {
        id: o.id,
        title: o.title,
        product: o.product_name,
        status: o.status,
        dossier: o.dossier,
        claims: o.claims
          .map((c: any) => ({
            id: c.id,
            kind: c.kind,
            statement: c.statement,
            quote: c.quote,
            review: c.review_status,
            url: c.url,
          }))
          .sort((a: any, b: any) => a.id.localeCompare(b.id)),
      };
    }),
  );
  return { rubricVersion: "v3", founder, items };
}
export async function compareOpportunities(
  db: Pool,
  job: { id: string; lock_token: string },
  provider: LLMProvider,
  model: string,
) {
  const renew = async () =>
    !!(
      await db.query(
        "UPDATE jobs SET locked_until=now()+interval '180 seconds' WHERE id=$1 AND lock_token=$2 AND status='running' AND locked_until>now()",
        [job.id, job.lock_token],
      )
    ).rowCount;
  if (!(await renew())) throw Error("比较任务租约失效");
  const input = await comparisonInput(db, true);
  if (!input.items.length) throw Error("暂无可比较机会");
  const inputHash = hash(JSON.stringify(input));
  const ids = input.items.map((o) => o.id);
  const dimension = z.object({
    score: z.number().int().min(1).max(5).nullable(),
    reason: z.string().min(1).max(800),
  });
  const schema = z.object({
    items: z
      .array(
        z.object({
          id: z.enum(ids as [string, ...string[]]),
          demand: dimension,
          value: dimension,
          feasibility: dimension,
          acquisition: dimension,
          fit: dimension,
          nextStep: z.string().min(1).max(1200),
          biggestUnknown: z.string().min(1).max(1200),
          differentiation: z.enum(["distinct", "overlap", "unknown"]),
          differentiationReason: z.string().min(1).max(1200),
        }),
      )
      .length(ids.length),
  });
  const compact = {
    founder: input.founder,
    items: input.items.map((o) => ({
      ...o,
      dossier: Object.fromEntries(
        Object.entries(o.dossier).map(([k, v]) => [
          k,
          typeof v === "string" ? v.slice(0, 700) : v,
        ]),
      ),
      claims: o.claims.slice(0, 12).map((c: any) => ({
        ...c,
        statement: c.statement.slice(0, 500),
        quote: c.quote.slice(0, 600),
      })),
    })),
    coverageNote:
      "每项最多12条声明，声明600字和档案字段700字以外截断；非全网调查。",
  };
  const { value } = await runStructured(
    db,
    provider,
    {
      promptName: "opportunity-comparison",
      promptVersion: "v1",
      model,
      input: compact,
    },
    schema,
  );
  if (new Set(value.items.map((o) => o.id)).size !== ids.length)
    throw Error("比较结果包含重复或缺失机会");
  const hasFounder = Object.values(input.founder).some(
    (v) => typeof v === "string" && v.trim(),
  );
  const items = value.items
    .map((o) => {
      if (!hasFounder)
        o.fit = {
          score: null,
          reason: "创始人资料未填写，无法判断个人匹配度。",
        };
      const claims = input.items.find((x) => x.id === o.id)!.claims;
      if (
        !claims.some(
          (c: any) => c.kind === "pain" && c.review !== "rejected",
        ) &&
        o.demand.score != null &&
        o.demand.score > 2
      )
        o.demand = {
          score: 2,
          reason: "缺少用户痛点声明，需求评分上限2分。" + o.demand.reason,
        };
      const scores = Object.fromEntries(
        Object.keys(weights).map((k) => [
          k,
          o[k as keyof typeof weights].score,
        ]),
      );
      const calculated = comparisonScore(scores);
      const priorityBlocker =
        input.items.find((x) => x.id === o.id)!.dossier.comparisonBlocker || "";
      if (o.differentiation === "overlap" || priorityBlocker)
        calculated.score = null;
      if (
        !claims.some((c: any) => c.kind === "pain" && c.review === "accepted")
      )
        o.nextStep =
          "先核对已有功能，并通过不写代码的需求访谈验证痛点；以下是模型后续草案，暂不投入开发：" +
          o.nextStep;
      return {
        ...o,
        ...calculated,
        priorityBlocker,
        acceptedPain: claims.filter(
          (c: any) => c.kind === "pain" && c.review === "accepted",
        ).length,
        acceptedCommercial: claims.filter(
          (c: any) =>
            ["market", "revenue"].includes(c.kind) && c.review === "accepted",
        ).length,
      };
    })
    .sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) ||
        b.coverage - a.coverage ||
        a.id.localeCompare(b.id),
    );
  if (!(await renew())) throw Error("比较任务租约失效");
  return transaction(db, async (c) => {
    const j = (
      await c.query("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [job.id])
    ).rows[0];
    if (
      j.status !== "running" ||
      j.lock_token !== job.lock_token ||
      new Date(j.locked_until).getTime() <= Date.now()
    )
      throw Error("比较任务租约失效");
    await c.query(
      "INSERT INTO opportunity_comparisons(job_id,input_hash,input_snapshot,result) VALUES($1,$2,$3,$4) ON CONFLICT(job_id) DO NOTHING",
      [
        job.id,
        inputHash,
        JSON.stringify(input),
        JSON.stringify({ items, weights }),
      ],
    );
    await c.query(
      "UPDATE jobs SET status='succeeded',locked_until=null,lock_token=null,last_error=null,updated_at=now() WHERE id=$1",
      [job.id],
    );
  });
}
