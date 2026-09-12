import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readiness,
  dossierSchema,
} from "../packages/opportunities/src/service.js";
test("localization requires distinct markets and target-market pain, source pain cannot unlock it", () => {
  const claims = [
    { kind: "revenue", review_status: "accepted", market_role: "source" },
    { kind: "pain", review_status: "accepted", market_role: "source" },
  ];
  const dossier = {
    opportunityType: "localization",
    sourceMarket: "美国",
    targetMarket: "欧洲",
  };
  assert.equal(readiness(claims).ready, true);
  assert.equal(readiness(claims, dossier).ready, false);
  claims[1].market_role = "target";
  claims[0].kind = "market";
  assert.equal(readiness(claims, dossier).ready, false);
  claims[0].kind = "revenue";
  assert.equal(readiness(claims, dossier).ready, true);
  assert.equal(
    readiness(claims, { ...dossier, targetMarket: "美国" }).ready,
    false,
  );
  assert.equal(dossierSchema.parse({}).opportunityType, "workflow");
});
