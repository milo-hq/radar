# Contextual demand evidence review

Extraction previously selected a sentence and applied lexical tripwires only to that sentence. This lost counterevidence elsewhere in the saved post.

A separate structured review now reads original context (up to 12,000 characters), truncation/context flags, and no generated candidate claims. It labels author role and resolution status and selects original line indices. The application copies those lines and retains direct-user, unresolved signals with grounded evidence. Batch records preserve decisions and rejection reasons. Missing/duplicate decisions or nonexistent line indices fail the task rather than becoming a successful empty report. Historical reports and raw documents are unchanged.

An initial free-text quote review paraphrased evidence in live testing. The deployed version selects line indices instead. Role and resolution judgments remain probabilistic; an exact quotation does not guarantee a correct interpretation.

Validation: 27 unit tests, 55 database tests, TypeScript and production build. Four live model fixtures pass: completed n8n demonstration, functioning permission guard, and founder history rejected; developer with continuing export costs retained. scripts/evaluate-evidence-context.ts uses synthetic fixtures without inserting raw evidence.

Live replay 41fd5461-2c67-4989-b3ed-dc2baa879f91 analyzed 18 documents. It rejected generic Calendly marketing, Cal.com history, n8n demonstration and email promotion. Two exploratory recommendations survived. It still overinterpreted the clipped Notion gateway post and proposed journalist verification with poor solo-development feasibility. These remain observed failures, not validated opportunities. Missing context and feasibility/competitor checks require further work.

Reanalysis is idempotent under context-v2. Earlier replays remain separately traceable.
