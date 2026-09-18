INSERT INTO sources(id,name,kind) VALUES
 ('youtube','YouTube comments','youtube'),('v2ex','V2EX topics and replies','v2ex')
ON CONFLICT(id) DO NOTHING;
