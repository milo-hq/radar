INSERT INTO sources(id,name,kind) VALUES('hn','Hacker News','community');
ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK(type IN ('FETCH_SOURCE','TRANSLATE_DOCUMENT','ANALYZE_PRODUCT','DISCOVER_FEEDBACK'));
