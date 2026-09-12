ALTER TABLE opportunity_claims ADD COLUMN market_role text NOT NULL DEFAULT 'general' CHECK(market_role IN ('general','source','target'));
