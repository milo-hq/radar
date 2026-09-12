ALTER TABLE winning_products DROP CONSTRAINT winning_products_domain_key;
CREATE INDEX products_domain ON winning_products(domain);
CREATE TABLE product_identifiers(product_id uuid NOT NULL REFERENCES winning_products(id),url text NOT NULL UNIQUE,PRIMARY KEY(product_id,url));
INSERT INTO product_identifiers SELECT DISTINCT ON(d.canonical_url) pd.product_id,d.canonical_url FROM product_documents pd JOIN raw_documents d ON d.id=pd.raw_document_id ORDER BY d.canonical_url,d.collected_at DESC;
CREATE TABLE evidence_claims(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid NOT NULL REFERENCES winning_products(id),raw_document_id uuid NOT NULL REFERENCES raw_documents(id),
 kind text NOT NULL CHECK(kind IN ('market','pain','revenue','distribution')),statement text NOT NULL CHECK(length(trim(statement))>0),quote text NOT NULL CHECK(length(trim(quote))>0),
 review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','accepted','rejected')),origin text NOT NULL CHECK(origin IN ('human','model')),
 created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,
 UNIQUE(product_id,raw_document_id,kind,statement,quote)
);
CREATE TABLE opportunities(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid NOT NULL REFERENCES winning_products(id),title text NOT NULL CHECK(length(trim(title))>0),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','WATCH','VALIDATE','KILL')),dossier jsonb NOT NULL,founder_snapshot jsonb NOT NULL DEFAULT '{}',
 research_job_id uuid REFERENCES jobs(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE opportunity_claims(opportunity_id uuid NOT NULL REFERENCES opportunities(id),claim_id uuid NOT NULL REFERENCES evidence_claims(id),PRIMARY KEY(opportunity_id,claim_id));
CREATE TABLE opportunity_decisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),opportunity_id uuid NOT NULL REFERENCES opportunities(id),decision text NOT NULL CHECK(decision IN ('WATCH','VALIDATE','KILL')),reason text NOT NULL CHECK(length(trim(reason))>0),snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX opportunity_claim_lookup ON opportunity_claims(claim_id);
CREATE INDEX claim_product ON evidence_claims(product_id);
CREATE INDEX opportunity_product ON opportunities(product_id);
ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK(type IN ('FETCH_SOURCE','TRANSLATE_DOCUMENT','ANALYZE_PRODUCT'));
