ALTER TABLE leads ADD COLUMN IF NOT EXISTS website_snapshot JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_signals JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS commercial_profile JSONB;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_enrichment_status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_started_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_completed_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_last_error TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_retry_count INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_processing_duration_ms INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_cost_estimate NUMERIC DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_model_versions JSONB DEFAULT '{"snapshot":"v1","signals":"v1","profile":"v1"}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_leads_ci_status ON leads(user_id, ci_enrichment_status) WHERE ci_enrichment_status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_leads_ci_completed ON leads(user_id, ci_completed_at DESC) WHERE ci_enrichment_status = 'completed';
