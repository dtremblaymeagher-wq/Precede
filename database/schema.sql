-- PM AI Toolkit — Supabase schema (canonical state post-migration 001)
-- Run this for fresh installs. Existing DBs: run migrations/ in order instead.
-- All tables use user_id (Clerk user ID, e.g. "user_2abc...") as a plain text column.
-- RLS is enabled as defense-in-depth; the server always filters by both
-- user_id and instance_id explicitly (Option A — server-enforced instance isolation).


-- ─── JIRA CONNECTIONS ─────────────────────────────────────────────────────────
-- Shared Jira credentials at team level. Referenced by instances via FK.
-- No user_id — access controlled by created_by.

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


-- ─── INSTANCES ────────────────────────────────────────────────────────────────
-- One row per virtual workspace. A user can have multiple instances.
-- Think of it as Slack workspaces — same login, completely separate contexts.

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
  instance_type      text        NOT NULL DEFAULT 'pm'
                     CHECK (instance_type IN ('pm', 'executive')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_instances" ON instances
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS instances_user_id_idx ON instances (user_id);


-- ─── INSTANCE TRANSFERS ───────────────────────────────────────────────────────

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


-- ─── SETTINGS ─────────────────────────────────────────────────────────────────
-- One row per (user, instance). Personas, clients, templates, sprint config.

CREATE TABLE IF NOT EXISTS settings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  instance_id uuid        NOT NULL,
  data        jsonb       NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, instance_id)
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_settings" ON settings
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS settings_instance_id_idx ON settings (instance_id);


-- ─── INTELLIGENCE HUB ENTRIES ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  instance_id uuid        NOT NULL,
  data        jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE intelligence_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_entries" ON intelligence_entries
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS intelligence_entries_user_id_idx    ON intelligence_entries (user_id);
CREATE INDEX IF NOT EXISTS intelligence_entries_instance_id_idx ON intelligence_entries (instance_id);


-- ─── ANALYSIS HISTORY ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analysis_history (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  instance_id uuid        NOT NULL,
  filename    text        NOT NULL,
  data        jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analysis_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_history" ON analysis_history
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS analysis_history_user_id_idx     ON analysis_history (user_id);
CREATE INDEX IF NOT EXISTS analysis_history_instance_id_idx ON analysis_history (instance_id);


-- ─── BACKLOG STORIES ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS backlog_stories (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text        NOT NULL,
  instance_id   uuid        NOT NULL,
  filename      text        NOT NULL,
  data          jsonb       NOT NULL,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, instance_id, filename)
);

ALTER TABLE backlog_stories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_stories" ON backlog_stories
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS backlog_stories_user_id_idx     ON backlog_stories (user_id);
CREATE INDEX IF NOT EXISTS backlog_stories_instance_id_idx ON backlog_stories (instance_id);


-- ─── RADAR MEMORY ──────────────────────────────────────────────────────────────
-- One row per (user, instance). Structure must not change (breaks delta detection).

CREATE TABLE IF NOT EXISTS radar_memory (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  instance_id uuid        NOT NULL,
  data        jsonb       NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, instance_id)
);

ALTER TABLE radar_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_radar_memory" ON radar_memory
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS radar_memory_instance_id_idx ON radar_memory (instance_id);


-- ─── VISION ───────────────────────────────────────────────────────────────────
-- One row per (user, instance).

CREATE TABLE IF NOT EXISTS vision (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  instance_id uuid        NOT NULL,
  data        jsonb       NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, instance_id)
);

ALTER TABLE vision ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_vision" ON vision
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS vision_instance_id_idx ON vision (instance_id);


-- ─── SPRINT EXCEPTIONS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sprint_exceptions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  instance_id uuid        NOT NULL,
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  label       text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE sprint_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_sprint_exceptions" ON sprint_exceptions
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS sprint_exceptions_user_id_idx     ON sprint_exceptions (user_id);
CREATE INDEX IF NOT EXISTS sprint_exceptions_instance_id_idx ON sprint_exceptions (instance_id);


-- ─── ONBOARDING ────────────────────────────────────────────────────────────────
-- Platform-level, NOT per-instance. One row per user account.

CREATE TABLE IF NOT EXISTS onboarding (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text        NOT NULL UNIQUE,
  completed    boolean     NOT NULL DEFAULT false,
  current_step integer     NOT NULL DEFAULT 1,
  completed_at timestamptz,
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE onboarding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_onboarding" ON onboarding
  FOR ALL USING (user_id = auth.uid()::text);


-- ─── LEARNING VAULT ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS learning_vault (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  instance_id uuid        NOT NULL,
  data        jsonb       NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, instance_id)
);

ALTER TABLE learning_vault ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_vault" ON learning_vault
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS learning_vault_instance_id_idx ON learning_vault (instance_id);
