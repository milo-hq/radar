import { test } from "node:test";
import assert from "node:assert/strict";
import { demandEvidenceBlocker } from "../packages/radar/src/quality.js";
test("seller product descriptions and secondhand feedback cannot become buyer demand", () => {
  assert.ok(
    demandEvidenceBlocker(
      "Actually building software around improving npc interactions through generated micro expression. We are capturing body language that mocap misses and is too expensive for AAA studios.",
    ),
  );
  assert.ok(
    demandEvidenceBlocker(
      "My first Reddit post got two negative comments. Both said the same thing: too expensive for their country.",
    ),
  );
  assert.ok(
    demandEvidenceBlocker(
      "We launched our tool to fix expensive exports. Sign up today.",
    ),
  );
});
test("developers can be actual users; concrete requests and workarounds remain eligible", () => {
  assert.equal(
    demandEvidenceBlocker(
      "I build apps for clients. In ToolX I spend two hours every Friday merging exports manually. Please add cross-project reports.",
    ),
    null,
  );
  assert.equal(
    demandEvidenceBlocker(
      "I use ToolX daily but it lacks CSV export. I copy every row by hand.",
    ),
    null,
  );
  assert.equal(
    demandEvidenceBlocker(
      "Please add CSV export to ToolX; we manually copy 200 rows each week.",
    ),
    null,
  );
});
