CREATE TABLE sources(id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO sources VALUES ('manual','Manual URL','manual'),('winner','Winner Radar','winner'),('reddit','Reddit','reddit');
CREATE TABLE raw_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id text NOT NULL REFERENCES sources(id),external_id text NOT NULL,
 canonical_url text NOT NULL,type text NOT NULL CHECK(type IN ('post','comment','review','issue','job','article','product')),
 title text, body text NOT NULL CHECK(length(trim(body))>0),author_external_id text,author_name text,parent_external_id text,thread_external_id text,
 published_at timestamptz,collected_at timestamptz NOT NULL DEFAULT now(),engagement_score numeric,reply_count integer,
 normalized_content_hash text NOT NULL,snapshot_hash text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(source_id,external_id,snapshot_hash)
);
CREATE INDEX raw_documents_collected ON raw_documents(collected_at DESC);
CREATE INDEX raw_documents_thread ON raw_documents(source_id,thread_external_id);
CREATE FUNCTION reject_raw_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'raw_documents are immutable: append a new snapshot'; END $$;
CREATE TRIGGER raw_immutable BEFORE UPDATE OR DELETE ON raw_documents FOR EACH ROW EXECUTE FUNCTION reject_raw_mutation();
CREATE TABLE document_reviews(raw_document_id uuid PRIMARY KEY REFERENCES raw_documents(id),status text NOT NULL CHECK(status IN ('pending','accepted','rejected')),note text NOT NULL DEFAULT '',reviewed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE content_groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),normalized_content_hash text NOT NULL UNIQUE);
CREATE TABLE content_group_documents(content_group_id uuid REFERENCES content_groups(id),raw_document_id uuid REFERENCES raw_documents(id),PRIMARY KEY(content_group_id,raw_document_id));
CREATE TABLE winning_products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),domain text NOT NULL UNIQUE,name text NOT NULL,target_customer text NOT NULL DEFAULT '',core_job text NOT NULL DEFAULT '',monetization text NOT NULL DEFAULT 'UNKNOWN',proof_level integer NOT NULL DEFAULT 0 CHECK(proof_level BETWEEN 0 AND 6),review_status text NOT NULL DEFAULT 'unreviewed',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE product_documents(product_id uuid REFERENCES winning_products(id),raw_document_id uuid REFERENCES raw_documents(id),PRIMARY KEY(product_id,raw_document_id));
CREATE TABLE revenue_signals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid NOT NULL REFERENCES winning_products(id),raw_document_id uuid NOT NULL REFERENCES raw_documents(id),kind text NOT NULL CHECK(kind IN ('VERIFIED','DISCLOSED','ESTIMATED','INFERRED')),amount numeric NOT NULL CHECK(amount>=0),currency text NOT NULL,period text NOT NULL CHECK(period IN ('month','year','one_time')),quote text NOT NULL CHECK(length(trim(quote))>0),confidence integer NOT NULL CHECK(confidence BETWEEN 0 AND 100),created_at timestamptz DEFAULT now());
CREATE TABLE founder_profiles(id integer PRIMARY KEY CHECK(id=1),profile jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO founder_profiles VALUES(1,'{"technicalStrength":"","preferredProductTypes":"","preferredDistribution":"","capitalPreference":"","salesPreference":"","avoidedMarkets":"","riskPreference":""}',now());
CREATE TABLE query_profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id text NOT NULL REFERENCES sources(id),url text NOT NULL,name text NOT NULL DEFAULT '',enabled boolean NOT NULL DEFAULT true,interval_hours integer NOT NULL DEFAULT 24 CHECK(interval_hours>=1),next_run_at timestamptz NOT NULL DEFAULT now(),UNIQUE(source_id,url));
CREATE TABLE jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),type text NOT NULL CHECK(type='FETCH_SOURCE'),payload jsonb NOT NULL,idempotency_key text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed')),attempts integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 4,run_at timestamptz NOT NULL DEFAULT now(),locked_until timestamptz,lock_token uuid,last_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX jobs_ready ON jobs(run_at) WHERE status IN ('pending','running');
CREATE TABLE model_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),prompt_name text NOT NULL,prompt_version text NOT NULL,prompt_hash text NOT NULL,model text NOT NULL,input_tokens integer,output_tokens integer,estimated_cost numeric,latency_ms integer NOT NULL,schema_valid boolean NOT NULL,success boolean NOT NULL,error text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),action text NOT NULL,entity_id text,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
