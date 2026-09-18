# Global Discovery Implementation Plan

**Goal:** Implement the approved global, multilingual evidence workflow with optional YouTube/V2EX sources.
**Architecture:** Versioned scan policy drives additive multilingual queries and storefront rotation; grounded market annotations are independent of query locale. Optional collectors feed existing immutable documents and analysis jobs.
**Tech Stack:** TypeScript/PostgreSQL, Python data engine, React, existing browser bridge.
**Spec:** docs/superpowers/specs/2026-09-18-global-discovery.md

## Constraints
No country exclusions; Chinese output; unknown geography stays unknown; preserve historical reports; no false connected-source status; no extra browser permissions without user action.

- [x] Global policy and tests: create packages/core/src/discovery-policy.ts; persist plan policy, additive X language queries, rotate App Store country via worker/data-engine adapter. Retain baseline English queries and idempotent task keys.
- [x] Optional collectors and tests: implement YouTube/V2EX HTTP adapters with injected fetch, limits and precise source identity; wire source enums/migration/worker/env and credential readiness into planning/UI.
- [x] Grounded evidence markets: extend context review schema and prompt version; derive original-language/observed-market report annotations from literal original lines; never infer country from language or storefront. Regression tests for fabricated evidence and unknowns.
- [x] Global UI: show global scope/search coverage/source readiness, remove restricted localization defaults, show languages and market evidence on recommendation details.
- [x] Run unit, DB, typecheck and build; review changes; migrate/deploy; inspect live UI and API; document limits, commit/push.

Ruling: use the existing authorized project branch and local deployment; no unrelated worktree migration. Optional API credentials are not assumed available. Source adapters can be verified with deterministic HTTP fixtures; live access status must be reported separately.

Validation: 42 unit tests, 58 DB tests, 3 browser parser tests passed; TypeScript and Docker production build passed. Migration 017 applied. API/worker deployed; live UI checked. YouTube/V2EX keys absent, so live collection not claimed. Existing active full scan retains its original plan; new strategy applies to subsequent scans. Review corrected omitted YouTube language, total collection deadline, and Latin market substring false positives.
