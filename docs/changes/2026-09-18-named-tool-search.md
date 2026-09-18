# Named-tool discovery

Replace generic browser complaint queries with a curated rotating seed catalog of 12 software tools. Each new scan selects four targets and persists them in `plan.toolTargets`; browser retries reuse the same targets. Reddit, X, HN, GitHub, Stack Overflow, App Store and WordPress search tasks reference these products. Existing website crawls remain independent.

Reddit uses one target per configured community; X uses four named-product queries. The UI shows selected products, including standalone X scans. Search planning is deterministic and no longer consumes an LLM call. Analysis still uses the configured model. Existing history is unchanged.

Add a narrow publication guard against the enterprise-wide BI platform pattern observed in the previous real report. This does not establish a general semantic feasibility classifier.

Validation: 25 unit tests, 53 database tests, TypeScript and production build. Database regression covers cross-source target agreement, preserved plan fields, retry reuse, rotation and stale-lease fencing. Live X scan: c91a1347-46b5-4f81-8b4f-c10e7829c9bb — 19 collected, 18 after deduplication, no failed jobs. Reanalysis 74c69f24-4ed1-471b-8197-f13e70dfc00c retained three exploratory candidates after rejecting the founder-origin story and some unsupported claims.

Limitations: the catalog is curated, not dynamically discovered. Common names can still return unrelated results. Product alignment is not proof of cross-source corroboration. Source eligibility filtering and actual-user evidence checks remain necessary; no opportunity count is guaranteed.

Live evaluation also found unresolved analysis weaknesses: second-person marketing text and demonstrations of already-built workflows can still be selected; feasibility estimates remain speculative. The three candidates are not validated opportunities. Current lexical guards cannot replace a contextual evidence-role evaluation and competitor verification.
