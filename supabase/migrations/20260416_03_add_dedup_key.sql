-- Add dedup_key to agent_lead_queue for stable per-mission deduplication
ALTER TABLE agent_lead_queue ADD COLUMN IF NOT EXISTS dedup_key TEXT;

-- Backfill existing rows: domain-first key
UPDATE agent_lead_queue
SET dedup_key = CASE
  WHEN website IS NOT NULL AND website != '' THEN
    LOWER(REGEXP_REPLACE(REGEXP_REPLACE(website, '^https?://(www\.)?', ''), '[/?#].*$', ''))
  WHEN email IS NOT NULL AND email != '' THEN
    LOWER(SPLIT_PART(email, '@', 2))
  ELSE
    LOWER(COALESCE(business_name, '') || '-' || COALESCE(location, ''))
END
WHERE dedup_key IS NULL;

-- Unique constraint: one lead per mission per key (partial: only when key is non-empty)
CREATE UNIQUE INDEX IF NOT EXISTS agent_lead_queue_mission_dedup_key_idx
  ON agent_lead_queue(mission_id, dedup_key)
  WHERE dedup_key IS NOT NULL AND dedup_key != '';

-- Add dedup_key to outreach_queue for strict 1 draft per lead per mission
ALTER TABLE outreach_queue ADD COLUMN IF NOT EXISTS dedup_key TEXT;

-- Backfill existing outreach rows
UPDATE outreach_queue
SET dedup_key = CASE
  WHEN website IS NOT NULL AND website != '' THEN
    LOWER(REGEXP_REPLACE(REGEXP_REPLACE(website, '^https?://(www\.)?', ''), '[/?#].*$', ''))
  WHEN contact_email IS NOT NULL AND contact_email != '' THEN
    LOWER(SPLIT_PART(contact_email, '@', 2))
  ELSE
    LOWER(COALESCE(company_name, '') || '-' || COALESCE(location, ''))
END
WHERE dedup_key IS NULL;

-- Unique constraint: one draft per mission per key
CREATE UNIQUE INDEX IF NOT EXISTS outreach_queue_mission_dedup_key_idx
  ON outreach_queue(mission_id, dedup_key)
  WHERE mission_id IS NOT NULL AND dedup_key IS NOT NULL AND dedup_key != '';
