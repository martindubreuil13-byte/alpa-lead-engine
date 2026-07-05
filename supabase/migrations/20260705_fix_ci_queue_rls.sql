-- Fix: Add user_id column and RLS policies to commercial_intelligence_queue
-- Root cause: RLS was enabled but no policies allowed authenticated users to insert

-- Step 1: Add user_id column matching ALPA's standard schema
-- Matches: leads.user_id, missions.user_id, icp.user_id, etc.
ALTER TABLE commercial_intelligence_queue
ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL
REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 3: Enable Row Level Security (idempotent)
ALTER TABLE commercial_intelligence_queue ENABLE ROW LEVEL SECURITY;

-- Step 4: Drop existing policies if they exist (clean slate)
DROP POLICY IF EXISTS "Users can view their own ci queue" ON commercial_intelligence_queue;
DROP POLICY IF EXISTS "Users can insert their own ci queue" ON commercial_intelligence_queue;
DROP POLICY IF EXISTS "Users can update their own ci queue" ON commercial_intelligence_queue;

-- Step 5: Create RLS policies following ALPA's security model
-- Policy: SELECT - users can view only their own queue records
CREATE POLICY "Users can view their own ci queue"
ON commercial_intelligence_queue
FOR SELECT
USING (auth.uid() = user_id);

-- Policy: INSERT - users can create queue records only for their own leads
CREATE POLICY "Users can insert their own ci queue"
ON commercial_intelligence_queue
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy: UPDATE - users can update only their own queue records
CREATE POLICY "Users can update their own ci queue"
ON commercial_intelligence_queue
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Step 6: Verify RLS is properly configured
-- List policies to confirm (run separately for verification):
-- SELECT tablename, policyname, permissive, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'commercial_intelligence_queue'
-- ORDER BY policyname;
