-- Add Commercial Intelligence columns to leads table
-- Stores Website Snapshot, Business Signals, Commercial Profile

ALTER TABLE leads ADD COLUMN IF NOT EXISTS website_snapshot JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_signals JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS commercial_profile JSONB;

-- Enrichment metadata
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_enrichment_status VARCHAR(50) DEFAULT 'pending';
-- pending, processing, completed, failed, skipped
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_enriched_at TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_started_at TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_last_error TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_retry_count INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_processing_duration_ms INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_cost_estimate NUMERIC DEFAULT 0;

-- Track which extraction/model versions were used
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_model_versions JSONB DEFAULT '{"snapshot":"v1","signals":"v1","profile":"v1"}';

-- Index for querying pending enrichments
CREATE INDEX IF NOT EXISTS idx_leads_ci_status ON leads(user_id, ci_enrichment_status) WHERE ci_enrichment_status IN ('pending', 'processing');

-- Index for querying enriched leads
CREATE INDEX IF NOT EXISTS idx_leads_ci_enriched ON leads(user_id, ci_enriched_at DESC) WHERE ci_enrichment_status = 'completed';

-- Create job queue table for tracking enrichment attempts
CREATE TABLE IF NOT EXISTS commercial_intelligence_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  -- pending, processing, completed, failed, retrying

  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  processing_duration_ms INTEGER,

  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 5,
  next_retry_at TIMESTAMP,

  error_message TEXT,
  error_code VARCHAR(50),

  snapshot_status VARCHAR(50),
  signals_status VARCHAR(50),
  profile_status VARCHAR(50),

  total_cost NUMERIC DEFAULT 0,

  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),

  UNIQUE(lead_id, status) WHERE status IN ('pending', 'processing', 'retrying')
);

CREATE INDEX IF NOT EXISTS idx_ci_jobs_user_id ON commercial_intelligence_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_ci_jobs_lead_id ON commercial_intelligence_jobs(lead_id);
CREATE INDEX IF NOT EXISTS idx_ci_jobs_status ON commercial_intelligence_jobs(status) WHERE status IN ('pending', 'processing', 'retrying');
CREATE INDEX IF NOT EXISTS idx_ci_jobs_next_retry ON commercial_intelligence_jobs(next_retry_at) WHERE status = 'retrying';

-- Trigger to mark leads for enrichment when inserted
CREATE OR REPLACE FUNCTION mark_lead_for_enrichment()
RETURNS TRIGGER AS $$
BEGIN
  -- Only enrich leads that have a website
  IF NEW.website IS NOT NULL AND NEW.website != '' THEN
    NEW.ci_enrichment_status := 'pending';
  ELSE
    NEW.ci_enrichment_status := 'skipped';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_mark_lead_for_enrichment
BEFORE INSERT ON leads
FOR EACH ROW
EXECUTE FUNCTION mark_lead_for_enrichment();

-- Trigger to create job record when lead is inserted
CREATE OR REPLACE FUNCTION enqueue_commercial_intelligence_job()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ci_enrichment_status = 'pending' THEN
    INSERT INTO commercial_intelligence_jobs (user_id, lead_id, status, created_at, updated_at)
    VALUES (NEW.user_id, NEW.id, 'pending', now(), now())
    ON CONFLICT (lead_id, status) WHERE status IN ('pending', 'processing', 'retrying') DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_enqueue_ci_job
AFTER INSERT ON leads
FOR EACH ROW
EXECUTE FUNCTION enqueue_commercial_intelligence_job();
