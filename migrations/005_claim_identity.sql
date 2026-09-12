DO $$ DECLARE constraint_name text; BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='evidence_claims'::regclass AND contype='u' LOOP
 EXECUTE format('ALTER TABLE evidence_claims DROP CONSTRAINT %I',constraint_name);
 END LOOP;
END $$;
ALTER TABLE evidence_claims ADD COLUMN identity_hash text GENERATED ALWAYS AS (md5(statement || chr(31) || quote)) STORED;
ALTER TABLE evidence_claims ADD CONSTRAINT claim_identity UNIQUE(product_id,raw_document_id,kind,identity_hash);
