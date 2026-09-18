INSERT INTO sources(id,name,kind) VALUES('x','X (Twitter)','x') ON CONFLICT(id) DO NOTHING;
ALTER TABLE reddit_browser_connection ADD COLUMN x_enabled boolean NOT NULL DEFAULT false;
