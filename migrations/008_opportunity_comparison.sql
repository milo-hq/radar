ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK(type IN ('FETCH_SOURCE','TRANSLATE_DOCUMENT','ANALYZE_PRODUCT','DISCOVER_FEEDBACK','COMPARE_OPPORTUNITIES'));
CREATE TABLE opportunity_comparisons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL UNIQUE REFERENCES jobs(id),
 input_hash text NOT NULL,
 input_snapshot jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
