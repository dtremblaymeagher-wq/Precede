-- ============================================================
-- Migration 001 — Multi-instance architecture
-- Run once in the Supabase SQL editor.
-- Safe on existing data: creates a "Default" instance for every
-- existing user and backfills instance_id on all rows.
-- ============================================================


-- ─── STEP 1: jira_connections ─────────────────────────────────────────────────
-- Shared Jira credentials at team level (no user_id — referenced by instances).

CREATE TABLE IF NOT EXISTS jira_connections (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     text,
  created_by  text        NOT NULL,
  url         text        NOT NULL,
  credentials jsonb       NOT NULL,
  name        text,
  shared      boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE jira_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jira_connections_owner" ON jira_connections
  FOR ALL USING (created_by = auth.uid()::text);


-- ─── STEP 2: instances ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instances (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text        NOT NULL,
  name               text        NOT NULL,
  color              text        NOT NULL DEFAULT '#6366f1',
  vision_shared      boolean     NOT NULL DEFAULT false,
  jira_connection_id uuid        REFERENCES jira_connections(id),
  jira_filter        jsonb,
  squad_mode         boolean     NOT NULL DEFAULT false,
  jira_mode          text        NOT NULL DEFAULT 'full_sync',
  pm_tenure_start    date,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_instances" ON instances
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS instances_user_id_idx ON instances (user_id);


-- ─── STEP 3: instance_transfers ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instance_transfers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   uuid        NOT NULL REFERENCES instances(id),
  from_user_id  text        NOT NULL,
  to_user_id    text        NOT NULL,
  transfer_date timestamptz,
  context_note  text,
  conversation  jsonb,
  status        text        NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE instance_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transfer_parties_only" ON instance_transfers
  FOR ALL USING (
    from_user_id = auth.uid()::text OR to_user_id = auth.uid()::text
  );


-- ─── STEP 4: Add instance_id column (nullable) to all data tables ─────────────

ALTER TABLE intelligence_entries ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE analysis_history     ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE backlog_stories      ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE sprint_exceptions    ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE radar_memory         ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE vision               ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE settings             ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE learning_vault       ADD COLUMN IF NOT EXISTS instance_id uuid;

-- meeting_prep_history and integrations may or may not exist in your DB.
-- These blocks are safe to run regardless.
DO $$ BEGIN
  ALTER TABLE meeting_prep_history ADD COLUMN IF NOT EXISTS instance_id uuid;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE integrations ADD COLUMN IF NOT EXISTS instance_id uuid;
EXCEPTION WHEN undefined_table THEN NULL; END $$;


-- ─── STEP 5: Create a Default instance for every existing user ────────────────
-- Collects all unique user_ids across all tables, deduplicates, and inserts
-- exactly one "Default" instance per user. ON CONFLICT DO NOTHING makes this
-- idempotent — safe to re-run.

WITH all_users AS (
  SELECT DISTINCT user_id FROM intelligence_entries  WHERE user_id IS NOT NULL
  UNION
  SELECT DISTINCT user_id FROM analysis_history      WHERE user_id IS NOT NULL
  UNION
  SELECT DISTINCT user_id FROM backlog_stories        WHERE user_id IS NOT NULL
  UNION
  SELECT DISTINCT user_id FROM sprint_exceptions      WHERE user_id IS NOT NULL
  UNION
  SELECT DISTINCT user_id FROM radar_memory           WHERE user_id IS NOT NULL
  UNION
  SELECT DISTINCT user_id FROM vision                 WHERE user_id IS NOT NULL
  UNION
  SELECT DISTINCT user_id FROM settings               WHERE user_id IS NOT NULL
  UNION
  SELECT DISTINCT user_id FROM learning_vault         WHERE user_id IS NOT NULL
  UNION
  SELECT DISTINCT user_id FROM onboarding             WHERE user_id IS NOT NULL
)
INSERT INTO instances (user_id, name, color)
SELECT user_id, 'Default', '#6366f1'
FROM   all_users
ON CONFLICT DO NOTHING;


-- ─── STEP 6: Backfill instance_id on all existing rows ────────────────────────
-- Each row is matched to its user's Default instance (the one named 'Default').
-- Rows that already have an instance_id are left untouched.

UPDATE intelligence_entries e
SET    instance_id = i.id
FROM   instances i
WHERE  i.user_id = e.user_id
  AND  i.name    = 'Default'
  AND  e.instance_id IS NULL;

UPDATE analysis_history e
SET    instance_id = i.id
FROM   instances i
WHERE  i.user_id = e.user_id
  AND  i.name    = 'Default'
  AND  e.instance_id IS NULL;

UPDATE backlog_stories e
SET    instance_id = i.id
FROM   instances i
WHERE  i.user_id = e.user_id
  AND  i.name    = 'Default'
  AND  e.instance_id IS NULL;

UPDATE sprint_exceptions e
SET    instance_id = i.id
FROM   instances i
WHERE  i.user_id = e.user_id
  AND  i.name    = 'Default'
  AND  e.instance_id IS NULL;

UPDATE radar_memory e
SET    instance_id = i.id
FROM   instances i
WHERE  i.user_id = e.user_id
  AND  i.name    = 'Default'
  AND  e.instance_id IS NULL;

UPDATE vision e
SET    instance_id = i.id
FROM   instances i
WHERE  i.user_id = e.user_id
  AND  i.name    = 'Default'
  AND  e.instance_id IS NULL;

UPDATE settings e
SET    instance_id = i.id
FROM   instances i
WHERE  i.user_id = e.user_id
  AND  i.name    = 'Default'
  AND  e.instance_id IS NULL;

UPDATE learning_vault e
SET    instance_id = i.id
FROM   instances i
WHERE  i.user_id = e.user_id
  AND  i.name    = 'Default'
  AND  e.instance_id IS NULL;

DO $$ BEGIN
  UPDATE meeting_prep_history e
  SET    instance_id = i.id
  FROM   instances i
  WHERE  i.user_id = e.user_id
    AND  i.name    = 'Default'
    AND  e.instance_id IS NULL;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  UPDATE integrations e
  SET    instance_id = i.id
  FROM   instances i
  WHERE  i.user_id = e.user_id
    AND  i.name    = 'Default'
    AND  e.instance_id IS NULL;
EXCEPTION WHEN undefined_table THEN NULL; END $$;


-- ─── STEP 7: Make instance_id NOT NULL (all rows are backfilled above) ─────────

ALTER TABLE intelligence_entries ALTER COLUMN instance_id SET NOT NULL;
ALTER TABLE analysis_history     ALTER COLUMN instance_id SET NOT NULL;
ALTER TABLE backlog_stories      ALTER COLUMN instance_id SET NOT NULL;
ALTER TABLE sprint_exceptions    ALTER COLUMN instance_id SET NOT NULL;
ALTER TABLE radar_memory         ALTER COLUMN instance_id SET NOT NULL;
ALTER TABLE vision               ALTER COLUMN instance_id SET NOT NULL;
ALTER TABLE settings             ALTER COLUMN instance_id SET NOT NULL;
ALTER TABLE learning_vault       ALTER COLUMN instance_id SET NOT NULL;


-- ─── STEP 8: Fix UNIQUE constraints scoped to user_id alone ───────────────────
-- Tables whose UNIQUE was (user_id) now need (user_id, instance_id)
-- so each user can have one row *per instance* instead of one row total.

-- settings
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_user_id_key;
ALTER TABLE settings ADD CONSTRAINT settings_user_instance_key
  UNIQUE (user_id, instance_id);

-- radar_memory (structure unchanged per CLAUDE.md — only constraint scope widens)
ALTER TABLE radar_memory DROP CONSTRAINT IF EXISTS radar_memory_user_id_key;
ALTER TABLE radar_memory ADD CONSTRAINT radar_memory_user_instance_key
  UNIQUE (user_id, instance_id);

-- vision
ALTER TABLE vision DROP CONSTRAINT IF EXISTS vision_user_id_key;
ALTER TABLE vision ADD CONSTRAINT vision_user_instance_key
  UNIQUE (user_id, instance_id);

-- learning_vault
ALTER TABLE learning_vault DROP CONSTRAINT IF EXISTS learning_vault_user_id_key;
ALTER TABLE learning_vault ADD CONSTRAINT learning_vault_user_instance_key
  UNIQUE (user_id, instance_id);

-- backlog_stories: (user_id, filename) → (user_id, instance_id, filename)
ALTER TABLE backlog_stories DROP CONSTRAINT IF EXISTS backlog_stories_user_id_filename_key;
ALTER TABLE backlog_stories ADD CONSTRAINT backlog_stories_user_instance_filename_key
  UNIQUE (user_id, instance_id, filename);

-- Note: onboarding keeps UNIQUE(user_id) — it is platform-level, not per-instance.


-- ─── STEP 9: Indexes on instance_id for query performance ─────────────────────

CREATE INDEX IF NOT EXISTS intelligence_entries_instance_id_idx ON intelligence_entries (instance_id);
CREATE INDEX IF NOT EXISTS analysis_history_instance_id_idx     ON analysis_history     (instance_id);
CREATE INDEX IF NOT EXISTS backlog_stories_instance_id_idx      ON backlog_stories      (instance_id);
CREATE INDEX IF NOT EXISTS sprint_exceptions_instance_id_idx    ON sprint_exceptions    (instance_id);
CREATE INDEX IF NOT EXISTS radar_memory_instance_id_idx         ON radar_memory         (instance_id);
CREATE INDEX IF NOT EXISTS vision_instance_id_idx               ON vision               (instance_id);
CREATE INDEX IF NOT EXISTS settings_instance_id_idx             ON settings             (instance_id);
CREATE INDEX IF NOT EXISTS learning_vault_instance_id_idx       ON learning_vault       (instance_id);


-- ─── DONE ─────────────────────────────────────────────────────────────────────
-- Verify with:
--   SELECT COUNT(*) FROM instances;
--   SELECT user_id, name FROM instances ORDER BY created_at;
--   SELECT COUNT(*) FROM intelligence_entries WHERE instance_id IS NULL; -- should be 0
--   SELECT COUNT(*) FROM settings              WHERE instance_id IS NULL; -- should be 0
