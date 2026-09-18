# Keep source experiments separate from full discovery

The dashboard selected the newest scan regardless of scope. X-only collection and historical reanalysis therefore replaced the latest multi-source report. The earlier five-item report analyzed 616 of 640 collected documents, while several subsequent X-only replays analyzed 18. Report generation is capped at five recommendations, so these counts are not directly comparable.

The default dashboard now selects the newest full-discovery scan and its previous completed full-discovery report. Specialist scans and reanalysis remain addressable in history with explicit scope labels. Active specialist tasks remain visible and block duplicate starts. Historical scope is inferred from existing plan metadata; original reports are not rewritten. New scans persist their scope explicitly.

During collection, coverage was empty until all tasks completed, causing the UI to show zero even after hundreds of documents were saved. The API now returns distinct saved document counts per source while collecting. The UI distinguishes these provisional ingestion counts from final deduplication and analysis, and shows unavailable analysis counts as pending.

Validation: API regression reproduces newer X/Reddit/reanalysis records and confirms they cannot replace full-discovery results, while remaining readable in history. Unit, database, TypeScript and production-build checks run before deployment. Current full scan continues uninterrupted; deployment restarts only the API.

This fixes scope and progress reporting. It does not establish that adding X increases validated opportunities: queries, evidence policies and sampled material also changed across rounds. The current evidence verifier still has documented interpretation and feasibility limitations.
