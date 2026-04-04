-- Migration 003 — Fix integrations table for multi-instance support
-- Run once in the Supabase SQL editor.
--
-- The integrations table was originally created with UNIQUE(user_id).
-- Multi-instance requires UNIQUE(user_id, instance_id) so each instance
-- can have its own Jira config.

-- Step 1: Drop the old single-user constraint (if it exists)
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_user_id_key;

-- Step 2: Add the multi-instance constraint
ALTER TABLE integrations
  ADD CONSTRAINT integrations_user_instance_key
  UNIQUE (user_id, instance_id);

-- Step 3: Make instance_id NOT NULL (should already be backfilled from migration 001)
-- Wrap in DO block in case already NOT NULL
DO $$ BEGIN
  ALTER TABLE integrations ALTER COLUMN instance_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;
