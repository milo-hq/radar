import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buildApp } from "../apps/api/src/app.js";
import { saveDocuments } from "../packages/db/src/repository.js";
const db = new pg.Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    "postgresql://radar@127.0.0.1:55432/radar_test",
});
after(() => db.end());
test("opportunity evidence gate and validation decisions form a real loop", async () => {
  const app = await buildApp(db);
  try {
    const create = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: {
        name: "Test reference",
        url: "https://example.com/" + crypto.randomUUID(),
      },
    });
    assert.equal(create.statusCode, 200);
    const product = create.json();
    const [doc] = await saveDocuments(db, [
      {
        sourceKey: "manual",
        externalId: crypto.randomUUID(),
        canonicalUrl: "https://example.com/evidence",
        type: "article",
        body: "Paid plan costs $9.\nI spend hours exporting invoices.",
        metadata: { test: true },
      },
    ]);
    const bad = await app.inject({
      method: "POST",
      url: "/api/claims",
      payload: {
        productId: product.id,
        documentId: doc.id,
        kind: "pain",
        statement: "Demand",
        quote: "Invented",
      },
    });
    assert.equal(bad.statusCode, 400);
    const opp = await app.inject({
      method: "POST",
      url: "/api/opportunities",
      payload: {
        productId: product.id,
        title: "Invoice export for solo sellers",
        dossier: {},
      },
    });
    assert.equal(opp.statusCode, 200);
    const id = opp.json().id;
    assert.equal(
      (await app.inject("/api/opportunities/" + id)).json().readiness.ready,
      false,
    );
    const claims = [];
    for (const [kind, quote] of [
      ["market", "Paid plan costs $9."],
      ["pain", "I spend hours exporting invoices."],
    ]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/claims",
        payload: {
          productId: product.id,
          documentId: doc.id,
          kind,
          statement: quote,
          quote,
        },
      });
      assert.equal(r.statusCode, 200);
      claims.push(r.json().id);
      await app.inject({
        method: "POST",
        url: `/api/opportunities/${id}/claims`,
        payload: { claimId: r.json().id },
      });
      await app.inject({
        method: "PATCH",
        url: "/api/claims/" + r.json().id,
        payload: { reviewStatus: "accepted", opportunityId: id },
      });
    }
    assert.equal(
      (await app.inject("/api/opportunities/" + id)).json().readiness.ready,
      true,
    );
    const other = (
      await app.inject({
        method: "POST",
        url: "/api/opportunities",
        payload: {
          productId: product.id,
          title: "A different hypothesis",
          dossier: {},
        },
      })
    ).json();
    for (const claimId of claims)
      await app.inject({
        method: "POST",
        url: `/api/opportunities/${other.id}/claims`,
        payload: { claimId },
      });
    assert.equal(
      (await app.inject("/api/opportunities/" + other.id)).json().readiness
        .ready,
      false,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/opportunities/${id}/decisions`,
          payload: { decision: "VALIDATE", reason: "test" },
        })
      ).statusCode,
      400,
    );
    await app.inject({
      method: "PATCH",
      url: "/api/opportunities/" + id,
      payload: {
        dossier: {
          validation: {
            test: "Interview",
            budget: "$20",
            duration: "7 days",
            success: "3 paid trials",
            kill: "No buyers",
          },
        },
      },
    });
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/opportunities/${id}/decisions`,
          payload: { decision: "VALIDATE", reason: "Test payment" },
        })
      ).statusCode,
      200,
    );
    await app.inject({
      method: "PATCH",
      url: "/api/claims/" + claims[1],
      payload: { reviewStatus: "rejected", opportunityId: id },
    });
    const result = (await app.inject("/api/opportunities/" + id)).json();
    assert.equal(result.readiness.ready, false);
    assert.equal(result.decisions.length, 1);
    assert.equal(result.decisions[0].decision, "VALIDATE");
  } finally {
    await app.close();
  }
});
test("long exact evidence stays storable and two products can share a platform domain", async () => {
  const app = await buildApp(db);
  try {
    const p1 = (
      await app.inject({
        method: "POST",
        url: "/api/products",
        payload: {
          name: "Plugin A",
          url: "https://example.com/store/" + crypto.randomUUID(),
        },
      })
    ).json();
    const p2 = (
      await app.inject({
        method: "POST",
        url: "/api/products",
        payload: {
          name: "Plugin B",
          url: "https://example.com/store/" + crypto.randomUUID(),
        },
      })
    ).json();
    assert.notEqual(p1.id, p2.id);
    const quote = Array.from({ length: 120 }, () => crypto.randomUUID()).join(
      " ",
    );
    const [doc] = await saveDocuments(db, [
      {
        sourceKey: "manual",
        externalId: crypto.randomUUID(),
        canonicalUrl: "https://example.com/long",
        type: "article",
        body: quote,
        metadata: { test: true },
      },
    ]);
    const payload = {
      productId: p1.id,
      documentId: doc.id,
      kind: "market",
      statement: "Long source",
      quote,
    };
    const r = await app.inject({ method: "POST", url: "/api/claims", payload });
    assert.equal(r.statusCode, 200);
    const r2 = await app.inject({
      method: "POST",
      url: "/api/claims",
      payload,
    });
    assert.equal(r.json().id, r2.json().id);
  } finally {
    await app.close();
  }
});

test("feedback discovery queues without a model and reuses an active job", async () => {
  const app = await buildApp(db);
  try {
    const product = (
      await app.inject({
        method: "POST",
        url: "/api/products",
        payload: {
          name: "Feedback reference",
          url: "https://example.com/" + crypto.randomUUID(),
        },
      })
    ).json();
    const request = {
      method: "POST" as const,
      url: `/api/products/${product.id}/discover`,
      payload: {},
    };
    const first = await app.inject(request);
    const second = await app.inject(request);
    assert.equal(first.statusCode, 200);
    assert.equal(second.json().jobId, first.json().jobId);
    const job = (
      await db.query("SELECT type,payload FROM jobs WHERE id=$1", [
        first.json().jobId,
      ])
    ).rows[0];
    assert.equal(job.type, "DISCOVER_FEEDBACK");
    assert.equal(job.payload.productId, product.id);
    assert.equal(
      (
        await app.inject({
          ...request,
          url: `/api/products/${crypto.randomUUID()}/discover`,
        })
      ).statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});

test("comparison persists a complete snapshot, forces unknown founder fit, and detects changed input", async () => {
  const { compareOpportunities } = await import(
    "../packages/opportunities/src/comparison.js"
  );
  const old = (await db.query("SELECT id,status FROM opportunities")).rows;
  const founder = (
    await db.query("SELECT profile FROM founder_profiles WHERE id=1")
  ).rows[0].profile;
  let productId: string | undefined, jobId: string | undefined;
  const app = await buildApp(db);
  try {
    await db.query("UPDATE opportunities SET status='KILL'");
    await db.query("UPDATE founder_profiles SET profile='{}' WHERE id=1");
    productId = (
      await db.query(
        "INSERT INTO winning_products(name,domain) VALUES('comparison fixture','example.com') RETURNING id",
      )
    ).rows[0].id;
    const id = (
      await db.query(
        "INSERT INTO opportunities(product_id,title,dossier) VALUES($1,'Comparison fixture','{\"comparisonBlocker\":\"Existing product already supplies this workflow\"}') RETURNING id",
        [productId],
      )
    ).rows[0].id;
    const token = crypto.randomUUID();
    jobId = (
      await db.query(
        "INSERT INTO jobs(type,payload,idempotency_key,status,lock_token,locked_until) VALUES('COMPARE_OPPORTUNITIES','{}',$1,'running',$2,now()+interval '180 seconds') RETURNING id",
        [crypto.randomUUID(), token],
      )
    ).rows[0].id;
    const dimension = { score: 4, reason: "待验证假设" };
    const provider = {
      async generateStructured<T>() {
        return {
          value: {
            items: [
              {
                id,
                demand: dimension,
                value: dimension,
                feasibility: dimension,
                acquisition: dimension,
                fit: dimension,
                nextStep: "访谈目标客户",
                biggestUnknown: "尚无实际付费证据",
                differentiation: "unknown",
                differentiationReason: "缺少能力覆盖材料",
              },
            ],
          } as T,
          inputTokens: 1,
          outputTokens: 1,
          estimatedCost: null,
        };
      },
      async generateText() {
        throw Error("unused");
      },
    };
    await assert.rejects(
      compareOpportunities(
        db,
        { id: jobId!, lock_token: crypto.randomUUID() },
        provider,
        "fixture",
      ),
      /租约/,
    );
    await compareOpportunities(
      db,
      { id: jobId!, lock_token: token },
      provider,
      "fixture",
    );
    const before = (await app.inject("/api/comparison")).json().latest;
    assert.equal(before.stale, false);
    assert.equal(before.result.items[0].fit.score, null);
    assert.equal(before.result.items[0].coverage, 85);
    assert.equal(before.result.items[0].demand.score, 2);
    assert.equal(before.result.items[0].score, null);
    assert.match(before.result.items[0].priorityBlocker, /already supplies/);
    assert.equal(
      (await db.query("SELECT status FROM jobs WHERE id=$1", [jobId])).rows[0]
        .status,
      "succeeded",
    );
    await db.query(
      "UPDATE opportunities SET title='Changed hypothesis' WHERE id=$1",
      [id],
    );
    assert.equal(
      (await app.inject("/api/comparison")).json().latest.stale,
      true,
    );
    await db.query(
      "INSERT INTO opportunities(product_id,title,dossier) SELECT $1,'Extra ' || n,'{}' FROM generate_series(1,30) n",
      [productId],
    );
    const overLimit = await app.inject("/api/comparison");
    assert.equal(overLimit.statusCode, 200);
    assert.equal(overLimit.json().latest.stale, true);
  } finally {
    if (jobId) {
      await db.query("DELETE FROM opportunity_comparisons WHERE job_id=$1", [
        jobId,
      ]);
      await db.query("DELETE FROM jobs WHERE id=$1", [jobId]);
    }
    if (productId) {
      await db.query("DELETE FROM opportunities WHERE product_id=$1", [
        productId,
      ]);
      await db.query("DELETE FROM winning_products WHERE id=$1", [productId]);
    }
    for (const row of old)
      await db.query("UPDATE opportunities SET status=$2 WHERE id=$1", [
        row.id,
        row.status,
      ]);
    await db.query("UPDATE founder_profiles SET profile=$1 WHERE id=1", [
      JSON.stringify(founder),
    ]);
    await app.close();
  }
});
