# Venture Radar V1 — CODEX HANDOFF

> This document is the implementation source of truth for Codex.
> The interactive HTML is only for product understanding and visual reference.
> If there is any conflict, this Markdown document takes precedence.

---

# 1. Project Definition

Venture Radar is an **evidence-driven venture intelligence system for a solo founder**.

It is NOT:

- an AI startup idea generator
- a generic SEO keyword tool
- a universal crawler
- an autonomous founder agent
- a product factory
- an automated marketing system

Its purpose is to continuously discover:

> **Web/App opportunities where market demand is already partially proven, monetization is already partially proven, acquisition is partially proven, but a practical gap still exists that a solo founder can exploit.**

Primary user:

```text
Founder
```

V1 is an internal tool only.

Do not design V1 as a multi-tenant SaaS.

---

# 2. Core Principles

All implementation decisions must follow:

```text
PROOF > IDEA

MONEY > TRAFFIC

DISTRIBUTION > FEATURES

EVIDENCE > AI OPINION

VALIDATION > BUILDING

EXPECTED VALUE > MARKET SIZE
```

The system should prefer:

```text
proven demand
+
proven monetization
+
proven acquisition
+
remaining market gap
+
founder fit
```

The goal is to reduce the number of unknown variables in a venture before any product is built.

---

# 3. V1 Goal

V1 only needs to prove one thing:

> Venture Radar can continuously turn real public market information into a small set of high-quality opportunities worth investigating.

The required loop is:

```text
Real Market Data
↓
Winning Products / Pain Signals
↓
Revenue Evidence
↓
Demand Evidence
↓
SEO / Distribution Analysis
↓
Opportunity
↓
Evidence-backed Research
↓
Founder Decision
↓
WATCH / VALIDATE / KILL
```

If this loop is reliable, V1 is successful.

---

# 4. V1 Primary Strategy

V1 is explicitly:

```text
WINNER FIRST
```

Primary flow:

```text
Discover Winning Product
↓
Verify Business Value
↓
Understand Target User + Core JTBD
↓
Investigate Reddit / Reviews / Communities
↓
Extract Pain Evidence
↓
Analyze Acquisition / SEO
↓
Find Competitive Gap
↓
Evaluate Founder Fit
↓
Generate Opportunity
```

Reason:

A proven business is usually a better starting point than a raw complaint with unclear monetization.

---

# 5. V1 Priority

## P0 — Must Build

- Winner Radar
- Reddit Radar
- SEO Radar
- Basic Pain Evidence
- Evidence UX
- Opportunity Engine
- Deep Research
- Bull / Bear / Evidence Judge
- Founder Decision
- Validation Plan

## P1 — Basic Support Only

- Change Signals
- Distribution Signals
- Operator Behavior
- Revenue Intelligence refinements

## P2 — Do NOT Build Fully in V1

- Creator Radar
- Ad Intelligence
- automated X-for-Y engine
- full Growth Pattern Library
- multilingual market engine
- Product Factory
- automated launch
- automated marketing
- autonomous outreach

---

# 6. Five Radar Model

Long-term conceptual model:

```text
Pain Radar
Winner Radar
Distribution Radar
Change Radar
SEO Radar
```

V1 does NOT need all five at full depth.

V1 focus:

```text
Winner Radar
+
Reddit Pain Radar
+
SEO Radar
+
Opportunity Engine
```

---

# 7. Reddit Is a P0 Core Source

Reddit must be treated as a first-class source in V1.

It serves two roles:

## 7.1 Discovery Mining

Find real user problems from:

- industry subreddits
- profession subreddits
- software/product subreddits
- operational communities
- high-information comments

Signals to prioritize:

```text
manual work
workaround
missing feature
migration
switching intent
purchase intent
time cost
money cost
"we still use Excel"
"too expensive"
"alternative to"
"how do you deal with"
"any tool for"
```

## 7.2 Winner Investigation

For a discovered Winning Product:

```text
Winning Product
↓
Target User
↓
Relevant subreddits / search queries
↓
User Complaints / Alternatives / Pricing Discussions
↓
Pain Evidence
↓
Counter Evidence
```

The goal is to answer:

- Why do users use this?
- Why do users pay?
- What do they dislike?
- Why do users switch?
- Which use cases remain poorly served?
- Do users mention manual workaround?
- Do users mention explicit money/time cost?

---

# 8. Reddit Data Rules

Reddit ingestion must support:

- posts
- comments
- thread context
- parent-child relationship
- author identity when available
- published time
- score / engagement when available
- canonical URL
- subreddit metadata

Important rules:

1. Multiple comments from one author in the same thread do NOT count as multiple independent users.
2. Same content copied across threads must be grouped.
3. One subreddit is not equivalent to multi-source validation.
4. Author diversity and source diversity are separate metrics.
5. A popular post is not automatically strong demand.
6. Strong signals are:
   - explicit workflow
   - recurring pain
   - explicit spend
   - explicit time cost
   - active alternative search
   - active migration intent
7. Weak signals are:
   - generic frustration
   - “cool idea”
   - startup speculation
   - isolated feature wish
8. Reddit must also be used for counter-evidence.

---

# 9. Reddit Connector Boundary

Do NOT bind downstream intelligence to one acquisition method.

Use a replaceable connector strategy:

```text
Official/API path
+
Search discovery
+
Public page fetch
+
Browser fallback
+
Manual URL
```

Downstream only understands:

```text
RawDocument
```

Do not leak Reddit acquisition details into Opportunity Engine.

---

# 10. Winner Radar

Winner Radar answers:

> What products are already showing credible evidence of commercial success?

Signals:

- verified revenue
- disclosed revenue
- pricing
- subscription structure
- traffic
- search visibility
- backlink growth
- paid ad activity
- product updates
- new languages
- hiring
- review growth
- operator reinvestment

Core model:

```ts
interface WinningProduct {
  id: string

  name: string
  domain: string
  platforms: string[]

  category?: string

  targetCustomer?: string
  coreJob?: string
  coreMechanism?: string

  pricingModel?: string
  pricing?: unknown[]

  revenueSignals: RevenueSignal[]
  trafficSignals: TrafficSignal[]

  acquisitionChannels?: string[]

  organicTraffic?: number
  paidTraffic?: number

  backlinkProfile?: unknown

  languages?: string[]

  growthSignals?: unknown[]
  operatorSignals?: unknown[]

  proofLevel: number
  confidence: number
}
```

---

# 11. Revenue Evidence

All revenue claims must be typed.

```text
VERIFIED
DISCLOSED
ESTIMATED
INFERRED
```

## Tier A

Strongest:

- verified payment revenue
- verified MRR
- verified ARR

## Tier B

Medium:

- founder-disclosed revenue
- long-running paid ads
- large paid review base
- strong subscription evidence

## Tier C

Weak / estimated:

- traffic estimate
- order estimate
- third-party revenue estimate

Never render:

```text
MRR = $20K
```

if the value is only estimated.

Render:

```text
Estimated MRR: $20K
Confidence: Medium
Source: ...
```

---

# 12. Proof Level

Use:

```text
0  AI imagined
1  Users complain
2  Users actively use workaround
3  Users already pay
4  Existing product demonstrably makes money
5  Product + acquisition channel proven
6  Product + audience + distribution + monetization + specific gap
```

V1 should prioritize:

```text
Proof Level 4–6
```

---

# 13. Pain Evidence

Pain Evidence is structured evidence extracted from market content.

Core fields:

```ts
interface PainEvidence {
  id: string
  rawDocumentId: string

  actorRole?: string
  actorIndustry?: string
  actorCompanyType?: string
  actorCompanySize?: string

  jobToBeDone: string
  problem: string

  desiredOutcome?: string

  currentSolution?: string
  workaround?: string

  moneyValue?: number
  moneyCurrency?: string
  moneyPeriod?: string

  timeHours?: number
  timePeriod?: string

  switchingIntent: number
  buyingIntent: number
  urgency: number

  explicitFacts: string[]
  inferredFacts: string[]

  evidenceQualityScore: number
  extractionConfidence: number
}
```

---

# 14. Explicit Fact / Inference / Unknown

This separation is mandatory.

```text
EXPLICIT FACT
INFERENCE
UNKNOWN
```

Never allow:

```text
LLM inference
↓
stored as fact
↓
used as evidence by later model
↓
becomes market truth
```

All major claims must have traceable evidence.

If evidence is unavailable:

```text
UNKNOWN
```

---

# 15. Raw Document

RawDocument is the immutable factual source layer.

```ts
interface RawDocument {
  id: string

  sourceId: string

  externalId: string
  canonicalUrl: string

  type:
    | 'post'
    | 'comment'
    | 'review'
    | 'issue'
    | 'job'
    | 'article'
    | 'product'

  title?: string
  body: string

  authorExternalId?: string
  authorName?: string

  parentExternalId?: string
  threadExternalId?: string

  publishedAt?: Date
  collectedAt: Date

  engagementScore?: number
  replyCount?: number
  viewCount?: number

  normalizedContentHash: string

  metadata: Record<string, unknown>
}
```

Do not rewrite original source content.

AI interpretation belongs in downstream tables.

---

# 16. Problem Clustering

Do not rely on vector similarity alone.

Use:

```text
PainEvidence
↓
Embedding
↓
pgvector Top-K Retrieval
↓
LLM Semantic Judge
↓
JOIN / CREATE / RELATED
```

V1 supports only:

```text
JOIN
CREATE
RELATED
```

Do NOT build a full knowledge graph in V1.

Prefer fragmented clusters over incorrect merges.

---

# 17. SEO Radar

SEO Radar does NOT discover the business.

It answers:

> If a business opportunity is already commercially interesting, can the founder realistically acquire users through Google?

Correct order:

```text
Revenue Proof
↓
Demand Proof
↓
SEO Research
```

Wrong order:

```text
Search Volume
↓
Build Product
```

---

# 18. SEO Attackability Score

Use a custom score:

```text
SERP Weakness               20
Weak Authority Competitors  15
Directory Presence          10
Outdated Results            10
Poor Product Quality        10
Low Link Barrier            10
Search Intent Gap           10
Localization Gap             5
Trend                        5
Founder Build Advantage      5
-------------------------------
Total                      100
```

Every score must be explainable.

Example:

```text
SEO Attackability = 82

+ 3 directory results
+ 2 Reddit results
+ weak dedicated products
+ low backlink barrier
- one strong incumbent
```

Never output:

```text
AI thinks SEO is easy
```

---

# 19. SERP Supply Analysis

Classify top results into:

- Dedicated SaaS
- Dedicated Tool
- Generic Big Site
- Directory
- Blog
- Reddit
- Forum
- YouTube
- Old Product
- Low-quality Site

When top SERP contains many:

```text
Directory
Reddit
Generic Blog
Old Product
```

mark:

```text
Weak Specialized Supply
```

This is a strong opportunity signal when monetization is already proven.

---

# 20. Money vs Traffic

Never treat traffic as equivalent to business quality.

Track separately:

```text
Search Demand
Traffic
Revenue
Profitability
```

Approximate:

```text
Revenue Efficiency
≈ Estimated Revenue / Organic Traffic
```

This is a comparative heuristic only.

---

# 21. Monetization Quality

Analyze:

- Subscription
- Usage-based
- Credits
- Transaction Fee
- Qualified Leads
- One-time Purchase
- Affiliate
- Advertising
- None

Initial heuristic:

```text
Subscription        100
Usage-based          95
Credits              90
Transaction Fee      90
Qualified Leads      80
One-time Purchase    65
Affiliate            55
Advertising          30
None                  0
```

Do not treat these as permanent truths.

---

# 22. Operator Behavior

Track whether the product owner is still investing.

Signals:

- backlink growth
- new landing pages
- content growth
- active ads
- product releases
- pricing changes
- new languages
- new markets
- hiring
- social activity

Generate:

```text
Investment Intensity: 0–100
```

This is a supporting business signal, not proof by itself.

---

# 23. Competition Model

Do NOT use:

```text
less competition = better
```

Track separately:

```text
Market Validation
Competitive Gap
```

Example:

```text
0 competitors
Market Validation = 10
Competitive Gap = 100
```

can still be a bad market.

Whereas:

```text
5 profitable competitors
Market Validation = 95
Competitive Gap = 68
```

may be attractive.

---

# 24. Opportunity Traps

## SEO Trap

```text
SEO Attackability > 80
AND
Money Score < 40
```

Easy traffic, weak business.

## Money Trap

```text
Money Score > 85
AND
SEO Attackability < 25
AND
Distribution Access low
```

Good business, poor entry path.

## Platform Trap

```text
High Demand
+
High Revenue Potential
+
Critical Third-party Data Dependency
```

Must receive a significant penalty.

---

# 25. Sweet Spot

Highlight when:

```text
Money             >= 70
Proof             >= 70
SEO Attackability >= 65
Founder Fit       >= 70
Distribution      >= 50
```

UI label:

```text
🔥 SWEET SPOT
```

---

# 26. Opportunity Origin

V1 supports:

```text
PAIN
WINNER
HYBRID
```

Distribution-led may exist experimentally, but it is not a V1 primary path.

Preferred:

```text
WINNER
HYBRID
```

---

# 27. Opportunity Model

```ts
interface Opportunity {
  id: string

  origin:
    | 'PAIN'
    | 'WINNER'
    | 'DISTRIBUTION'
    | 'HYBRID'

  title: string

  targetCustomer: string
  buyer?: string

  problem: string
  desiredOutcome?: string

  referenceProducts: string[]

  painEvidenceIds: string[]
  revenueEvidenceIds: string[]
  distributionEvidenceIds: string[]
  changeEvidenceIds: string[]
  seoEvidenceIds: string[]

  proofLevel: number

  segmentDelta?: number
  monetizationModel?: string

  bullCase?: string
  bearCase?: string

  fatalRisks: string[]
  unresolvedQuestions: string[]

  ventureScore: number
  confidenceScore: number

  status:
    | 'DISCOVERED'
    | 'RESEARCHING'
    | 'WATCHING'
    | 'VALIDATING'
    | 'KILLED'
}
```

---

# 28. Minimum Opportunity Evidence

Before an Opportunity enters the main list:

```text
>= 1 Market/Product Evidence
AND
>= 1 Demand/Pain Evidence
```

For a strong research candidate, prefer:

```text
Revenue Signal
OR
Strong Monetization Evidence
```

Do not allow pure AI-generated ideas into the main opportunity list.

---

# 29. Venture Score

V1 uses fixed, explainable weights.

```text
Demand                 10
Revenue Proof          15
Monetization           10
Distribution           15
SEO Attackability      10
Competitive Gap        10
Growth / Change         5
Founder Fit            10
Buildability            5
AI Leverage             5
Retention Potential     5
--------------------------
100
```

Risk penalties are separate:

- Platform Dependency
- Data Dependency
- Regulation
- Capital Requirement
- Support Burden
- Enterprise Sales

No machine learning in V1.

---

# 30. Confidence Score

Confidence is independent from Venture Score.

Example:

```text
Score: 92
Confidence: 31
```

means:

high upside, weak evidence.

Whereas:

```text
Score: 79
Confidence: 94
```

may deserve higher priority.

Confidence should mainly derive from:

- evidence volume
- unique user count
- author diversity
- source diversity
- evidence quality
- revenue proof
- recency

Prefer deterministic calculation over pure LLM judgment.

---

# 31. Deep Research

V1 research should answer only:

```text
Who pays?
What problem?
How is it solved today?
Existing winners?
Revenue evidence?
Pricing?
Why do existing solutions fail?
How are users acquired?
Can SEO work?
What is the competitive gap?
Can one founder build it?
What are the main risks?
```

Target reading time:

```text
3–5 minutes
```

Do not generate consulting-style 40-page reports.

---

# 32. Bull / Bear / Evidence Judge

## Bull

Build the strongest viable business case using only available evidence.

No invented facts.

## Bear

Attempt to kill the opportunity.

Must test:

- willingness to pay
- free alternatives
- strong incumbents
- distribution difficulty
- platform dependency
- data dependency
- retention
- CAC
- support burden
- regulation
- founder mismatch

## Evidence Judge

Evaluate:

- evidence quality
- independence
- author diversity
- revenue proof
- counter evidence

Do not judge prose quality.

If evidence is missing:

```text
UNKNOWN
```

---

# 33. Validation Plan

No Opportunity should automatically become:

```text
BUILD
```

The system first identifies:

```text
Biggest Unknown
```

Then proposes the cheapest test.

Examples:

```text
Unknown: Will users pay?
→ Preorder

Unknown: Can SEO acquire users?
→ Landing page / content test

Unknown: Is outcome valuable?
→ Concierge MVP

Unknown: Does creator traffic convert?
→ Creator distribution test
```

Validation Plan fields:

```text
Biggest Unknown
Test Type
Target User
Sample Size
Budget
Duration
Success Criteria
Kill Criteria
```

---

# 34. Graveyard

Killed Opportunities are never deleted.

Store:

- Primary Reason
- Wrong Assumption
- Secondary Reasons
- Lesson
- Money Spent
- Hours Spent

V1 only stores this data.

Do NOT implement automatic learning yet.

---

# 35. Founder Fit

V1 founder profile is manually configured.

Fields:

- Technical Strength
- Preferred Product Types
- Preferred Distribution
- Capital Preference
- Sales Preference
- Avoided Markets
- Risk Preference

Founder Fit answers:

> Is this opportunity suitable for this founder?

Not:

> Is this objectively a good market?

---

# 36. V1 Source Scope

Initial source categories:

## P0

- Reddit
- Manual URL ingestion
- Winning product / revenue radar sources
- Search / SEO sources

## P1

- Hacker News
- GitHub Issues
- RSS
- selected public communities

Do not attempt full-internet coverage.

---

# 37. Source Connector Contract

All sources implement:

```ts
interface SourceConnector {
  discover(cursor?: string): Promise<DiscoveredItem[]>

  fetch(item: DiscoveredItem): Promise<RawDocument>
}
```

Connector examples:

```text
RedditConnector
ManualURLConnector
WinnerRadarConnector
SearchConnector
HackerNewsConnector
GitHubConnector
RSSConnector
```

Acquisition and intelligence must remain decoupled.

---

# 38. Architecture Recommendation

Preferred:

```text
Frontend
Next.js / React

Backend API
Go

Worker
Go

Browser Sidecar
Node.js + Playwright

Database
PostgreSQL + pgvector

Queue
Postgres-backed jobs

Deployment
Docker Compose
```

If all-TypeScript materially accelerates delivery, it is acceptable.

Architecture quality and iteration speed are more important than language practice.

---

# 39. V1 Infrastructure Boundary

Allowed:

- PostgreSQL
- pgvector
- simple Postgres job queue
- Docker
- scheduled workers
- REST/HTTP APIs

Forbidden unless proven necessary:

- Kafka
- Kubernetes
- Neo4j
- Elasticsearch
- Pinecone
- microservices
- service mesh
- distributed platform architecture

---

# 40. AI Roles

V1 logical roles:

```text
Extractor
Cluster Judge
Researcher
Bull
Bear
Evidence Judge
```

These do NOT need to be autonomous chat agents.

Do not build a multi-agent social system.

---

# 41. Model Tiering

```text
Tier 1 — Cheap/Fast
classification
relevance
structured extraction

Tier 2 — Medium
cluster matching
summarization

Tier 3 — Strong
deep research
bull
bear
judge
validation planning
```

Use expensive models only on small high-value candidate sets.

---

# 42. LLM Provider Abstraction

Business logic must not call a specific vendor SDK directly.

Use an abstraction such as:

```ts
interface LLMProvider {
  generateStructured<T>(request: unknown): Promise<T>
  generateText(request: unknown): Promise<string>
}
```

Provider implementations may include:

```text
OpenAIProvider
AnthropicProvider
```

---

# 43. Prompt Versioning

Prompts must not be scattered in business code.

Recommended:

```text
/prompts

signal-extractor/
  v1.md

cluster-judge/
  v1.md

research/
  customer-v1.md
  money-v1.md
  competition-v1.md
  distribution-v1.md
  seo-v1.md

bull/
  v1.md

bear/
  v1.md

judge/
  v1.md
```

Every model run stores:

- promptName
- promptVersion
- model
- inputTokens
- outputTokens
- estimatedCost
- latency
- schemaValid
- success
- error

---

# 44. Recommended Database Tables

```text
sources
query_profiles

raw_documents
content_groups
content_group_documents

pain_evidences

problem_clusters
cluster_evidences
cluster_relations

winning_products
revenue_signals
traffic_signals
operator_signals
seo_signals

opportunities
opportunity_evidence
opportunity_scores

research_runs
research_claims
research_claim_evidence

validation_plans

kill_records

founder_profiles

jobs
model_runs
audit_logs
```

---

# 45. Job System

Use:

```text
Postgres-backed Jobs
+
Worker Polling
```

Job types:

```text
FETCH_SOURCE
NORMALIZE_DOCUMENT
EXTRACT_SIGNAL
EMBED_EVIDENCE
MATCH_CLUSTER
REFRESH_PRODUCT
REFRESH_REDDIT_CONTEXT
REFRESH_SEO
GENERATE_OPPORTUNITY
RESEARCH_OPPORTUNITY
SCORE_OPPORTUNITY
```

Requirements:

- idempotent
- retry safe
- exponential backoff
- error logging
- observable status

Suggested idempotency:

```text
extract:{rawDocumentId}:{promptVersion}
```

---

# 46. UI Scope

V1 top navigation only:

```text
Radar
Products
Signals
Problems
Opportunities
Graveyard
Settings
```

Do not add:

- AI Center
- Agent Center
- Workflow Center
- Creator Center
- BI Center
- Growth Center

---

# 47. Dashboard Goal

Founder should understand within 5 minutes:

```text
New Winners
Reddit Pain Movers
Emerging Problems
Research Candidates
Top Opportunities
Needs Review
Killed Recently
```

Avoid dashboard vanity metrics.

---

# 48. Product Detail Goal

Within 30 seconds, Founder should know:

```text
What is it?
Who uses it?
How does it make money?
Why do we believe it makes money?
How does it acquire users?
What does Reddit say about the problem?
Is the operator still investing?
What gap may exist?
```

---

# 49. Opportunity Detail Goal

Within 60 seconds, Founder should know:

```text
What?
Who?
Who pays?
Why now?
Revenue proof?
Reference winners?
Reddit pain evidence?
SEO?
Distribution?
Competition?
Gap?
Founder fit?
Fatal risk?
Biggest unknown?
Cheapest validation?
```

Every major section must support:

```text
Show Evidence
```

---

# 50. Evidence UX

Evidence is a first-class object.

For any major claim, allow viewing:

- Original Text
- Source
- URL
- Published Date
- Evidence Type
- Confidence
- Explicit / Inferred classification

100% of major business claims must be traceable.

---

# 51. V1 Decision States

Only implement:

```text
DISCOVERED
RESEARCHING
WATCHING
VALIDATING
KILLED
```

Do NOT implement:

```text
BUILDING
LAUNCHED
GROWING
SCALE
```

Those belong to a later Product Factory phase.

---

# 52. V1 Explicit Non-Goals

Codex must NOT build:

- automatic SaaS generation
- automatic product deployment
- autonomous marketing
- autonomous creator outreach
- automatic ad spending
- universal crawler
- large-scale China platform scraping
- full Creator Radar
- full Ads Intelligence
- full Growth Pattern Library
- automated X-for-Y generation
- automated multilingual SEO engine
- self-training model
- fine-tuning pipeline
- self-adjusting scoring weights
- complex graph database
- multi-agent chat system
- microservices
- Kubernetes
- Kafka
- visually complex BI dashboard

Core rule:

```text
Useful > Complete
Explainable > Clever
Simple > Scalable
Evidence > AI Prose
```

---

# 53. V1 Acceptance Criteria

## 53.1 Winner Radar

At least:

```text
>= 200 WinningProduct candidates
>= 50 with Revenue Signal
>= 20 with Proof Level >= 4
```

Founder must be able to answer:

- what it does
- who uses it
- how it monetizes
- why we think it makes money
- where the evidence comes from

---

## 53.2 Raw Documents

At least:

```text
>= 1000 RawDocuments total
>= 300 Reddit RawDocuments
```

Reddit must include meaningful post/comment content, not title-only ingestion.

---

## 53.3 Pain Evidence

At least:

```text
>= 200 relevant PainEvidence
>= 100 originating from Reddit
```

Each includes at minimum:

- Problem
- Source
- Explicit / Inferred
- Confidence

Actor should be captured when possible.

---

## 53.4 Problem Clusters

At least:

```text
>= 30 meaningful ProblemClusters
```

Founder manually reviews Top 20.

Requirement:

```text
>= 70% cluster coherence
```

---

## 53.5 Reddit Investigation

At least:

```text
>= 10 Winning Products
```

must have dedicated Reddit reverse investigation.

The research UI must allow direct access back to original Reddit evidence.

---

## 53.6 SEO Radar

At least:

```text
>= 20 Product / Opportunity SEO analyses
```

Every Attackability score must be explainable.

No opaque AI score.

---

## 53.7 Opportunity Engine

At least:

```text
>= 20 Opportunity candidates
>= 10 Deep Researched
```

Founder rates Top 10:

```text
Worthless
Interesting
Research-worthy
Strong
```

Requirement:

```text
>= 60% are Research-worthy or Strong
```

This is one of the main V1 quality gates.

---

## 53.8 Bull / Bear / Judge

Every Deep Researched Opportunity includes:

- Bull Case
- Bear Case
- Evidence Judge
- Fatal Risks
- Unresolved Questions

Missing evidence must be:

```text
UNKNOWN
```

---

## 53.9 Score Explainability

For every Venture Score dimension:

```text
Why?
```

must show:

- inputs
- evidence
- rule
- weight

---

## 53.10 Validation Plans

Top 10 Opportunities must all have a specific plan containing:

```text
Biggest Unknown
What Test
Who
How Many
Budget
Duration
Success Criteria
Kill Criteria
```

Generic output like:

```text
Talk to users
```

is unacceptable.

---

## 53.11 Evidence Coverage

Requirement:

```text
100% major business claims traceable to >= 1 evidence item
```

---

# 54. Main Quality Metric

Do NOT optimize for:

```text
signals processed
documents crawled
AI calls
dashboard volume
```

Optimize for:

```text
Top-10 Opportunity Precision
```

Meaning:

> When the founder only has time to inspect 10 opportunities, how many are genuinely worth investigating?

Supporting metrics:

- High-quality Evidence / 1000 documents
- Useful Clusters / week
- Research Candidates / week
- False Positive Rate
- Opportunity → Validation Rate

---

# 55. First Benchmark

Run:

```text
1000 Signals Challenge
```

Input:

```text
>= 1000 RawDocuments
```

Output:

```text
Top 20 Problem / Product Opportunities
```

Founder labels:

```text
Worthless
Interesting
Research-worthy
Strong
```

Measure:

```text
Top-5 Precision
Top-10 Precision
False Positive Rate
```

---

# 56. Development Order

Codex must NOT open many large modules in parallel.

Use this sequence:

```text
1. Foundation

2. SourceConnector abstraction

3. Reddit + Manual URL + Winner source ingestion

4. RawDocument inspection UI

5. Winner Radar

6. Pain Extraction

7. Reddit thread/context validation

8. Human inspection

9. Clustering

10. SEO Analysis

11. Opportunity Engine

12. Deep Research

13. Bull / Bear / Evidence Judge

14. Validation Plan

15. Benchmark / Top-K Precision
```

---

# 57. Stop Conditions

At every intelligence layer:

```text
If real data quality is unreliable:
STOP
```

Fix that layer.

Do NOT compensate by adding more agents, more prompts, or more infrastructure.

Examples:

```text
Bad source data
→ fix connector

Bad PainEvidence
→ fix extraction

Bad clustering
→ fix cluster judge

Bad opportunities
→ inspect source mix / scoring / evidence
```

Do not continue upward with weak foundations.

---

# 58. Milestone 1

Required:

```text
>= 200 real product candidates
>= 500 real market documents
```

with reliable raw ingestion and inspection UI.

Reddit must already be included.

If source quality is poor, stop here.

---

# 59. Milestone 2

System must reliably produce:

```text
WinningProduct
Revenue Evidence
Reddit PainEvidence
ProblemCluster
SEO Attackability
```

Founder manually validates that outputs are broadly coherent.

---

# 60. Milestone 3

At least:

```text
10 Deep Researched Opportunities
```

Founder can confidently choose:

```text
WATCH
VALIDATE
KILL
```

and understand why.

This is the first point where Venture Radar demonstrates real business decision value.

---

# 61. Codex Hard Rules

1. Do not expand V1 scope.
2. Prefer real data over mock completeness.
3. Reddit is a P0 source.
4. Reddit requires thread/context handling.
5. Acquisition and intelligence must be decoupled.
6. AI outputs should be structured whenever possible.
7. Explicit Fact / Inference / Unknown must remain separated.
8. Every major Claim must link to Evidence.
9. Prompt files must be versioned.
10. Model runs must be observable.
11. Jobs must be idempotent and retry-safe.
12. Do not build a universal crawler.
13. Do not use opaque AI scoring.
14. Do not build a complex multi-agent system.
15. Do not build Product Factory in V1.
16. Do not build automated marketing in V1.
17. Do not add infrastructure for hypothetical future scale.
18. UI exists to improve founder decision speed.
19. When requirements are ambiguous, choose the simplest replaceable implementation.
20. Optimize for Top-10 Opportunity Precision.

---

# 62. Initial Codex Task

Before implementing broad business logic, first output:

1. understanding of the project
2. V1 architecture
3. monorepo structure
4. PostgreSQL schema design
5. pgvector strategy
6. SourceConnector abstraction
7. RedditConnector design
8. Reddit thread/context data model
9. Winner source connector design
10. Postgres job system
11. LLM provider abstraction
12. prompt versioning design
13. model-run observability
14. Milestone 1 task breakdown

Then begin implementation in the defined order.

Do not redesign the product.

Do not expand scope.

---

# 63. Definition of Done

V1 is done only when:

```text
real data flows continuously
+
Winner Radar surfaces credible money signals
+
Reddit surfaces real recurring pain
+
SEO Radar explains attackability
+
Opportunity Engine produces a small useful candidate set
+
major conclusions are evidence-backed
+
Founder can WATCH / VALIDATE / KILL
+
Top-10 opportunities are materially useful
```

The final system should help the Founder answer:

```text
What should I investigate?

Why is it interesting?

Who is already making money?

Why do users pay?

What does Reddit reveal about the pain?

Can I acquire users?

Can I enter through SEO?

What is the competitive gap?

Why am I suited to build it?

What is the biggest risk?

What is the cheapest next validation?
```

Every important answer must end in:

```text
Evidence.
```
