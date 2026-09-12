import { test } from "node:test";
import assert from "node:assert/strict";
import { comparisonScore } from "../packages/opportunities/src/comparison.js";
test("comparison keeps unknown distinct from zero and does not rank insufficient coverage", () => {
  assert.deepEqual(
    comparisonScore({
      demand: 5,
      value: null,
      feasibility: null,
      acquisition: null,
      fit: null,
    }),
    { score: null, coverage: 25 },
  );
  assert.deepEqual(
    comparisonScore({
      demand: 4,
      value: 4,
      feasibility: 4,
      acquisition: 4,
      fit: null,
    }),
    { score: 4, coverage: 85 },
  );
  assert.deepEqual(
    comparisonScore({
      demand: null,
      value: null,
      feasibility: null,
      acquisition: null,
      fit: null,
    }),
    { score: null, coverage: 0 },
  );
});
