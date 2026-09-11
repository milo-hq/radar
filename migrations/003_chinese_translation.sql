ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK(type IN ('FETCH_SOURCE','TRANSLATE_DOCUMENT'));
CREATE TABLE document_translations(
 raw_document_id uuid NOT NULL REFERENCES raw_documents(id),prompt_version text NOT NULL,model text NOT NULL,
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(raw_document_id,prompt_version)
);
CREATE TABLE translation_chunks(
 raw_document_id uuid NOT NULL REFERENCES raw_documents(id),prompt_version text NOT NULL,part_index integer NOT NULL,
 source_hash text NOT NULL,model text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(raw_document_id,prompt_version,part_index,model)
);
