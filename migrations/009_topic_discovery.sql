INSERT INTO sources(id,name,kind) VALUES('github','GitHub Issues','community'),('stackoverflow','Stack Overflow','community');
ALTER TABLE sources ADD COLUMN discovery_available_at timestamptz;
ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK(type IN ('FETCH_SOURCE','TRANSLATE_DOCUMENT','ANALYZE_PRODUCT','DISCOVER_FEEDBACK','COMPARE_OPPORTUNITIES','DISCOVER_TOPIC'));
CREATE TABLE discovery_documents (
 job_id uuid NOT NULL REFERENCES jobs(id),
 document_id uuid NOT NULL REFERENCES raw_documents(id),
 PRIMARY KEY(job_id,document_id)
);
