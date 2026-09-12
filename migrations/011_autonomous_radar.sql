ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK(type IN ('FETCH_SOURCE','TRANSLATE_DOCUMENT','ANALYZE_PRODUCT','DISCOVER_FEEDBACK','COMPARE_OPPORTUNITIES','DISCOVER_TOPIC','RADAR_PLAN','RADAR_EXTRACT','RADAR_REPORT'));
CREATE TABLE radar_scans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text NOT NULL CHECK(status IN ('planning','collecting','analyzing','reporting','complete','failed')),plan jsonb NOT NULL DEFAULT '{}',coverage jsonb NOT NULL DEFAULT '{}',report jsonb,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE radar_batches(job_id uuid PRIMARY KEY REFERENCES jobs(id),scan_id uuid NOT NULL REFERENCES radar_scans(id),result jsonb NOT NULL);
CREATE INDEX jobs_radar_scan ON jobs((payload->>'scanId')) WHERE payload ? 'scanId';
