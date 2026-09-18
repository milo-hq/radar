CREATE TABLE reddit_browser_connection (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 token_hash text,
 enabled boolean NOT NULL DEFAULT false,
 last_seen_at timestamptz,
 pause_reason text
);
INSERT INTO reddit_browser_connection(id) VALUES(true);
CREATE TABLE reddit_browser_snapshots (
 job_id uuid NOT NULL REFERENCES jobs(id),
 post_id text NOT NULL,
 PRIMARY KEY(job_id,post_id)
);
