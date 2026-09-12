ALTER TABLE opportunity_claims ADD COLUMN review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','accepted','rejected'));
