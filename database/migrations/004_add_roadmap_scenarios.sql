-- ============================================================
-- Migration 004 — Roadmap scenarios table
-- Run once in the Supabase SQL editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS roadmap_scenarios (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text        NOT NULL,
  instance_id  uuid        NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  note         text,
  epic_order   jsonb       NOT NULL DEFAULT '[]',
  visibility   text        NOT NULL DEFAULT 'private',
  share_token  text        UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE roadmap_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_roadmap_scenarios" ON roadmap_scenarios
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS roadmap_scenarios_user_id_idx     ON roadmap_scenarios (user_id);
CREATE INDEX IF NOT EXISTS roadmap_scenarios_instance_id_idx ON roadmap_scenarios (instance_id);

-- ─── DONE ─────────────────────────────────────────────────────────────────────
-- Verify with:
--   SELECT COUNT(*) FROM roadmap_scenarios;
