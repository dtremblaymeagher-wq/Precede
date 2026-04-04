-- ============================================================
-- Migration 005 — Roadmap milestones table
-- Run once in the Supabase SQL editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS roadmap_milestones (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text        NOT NULL,
  instance_id     uuid        NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  date            date        NOT NULL,
  type            text        NOT NULL DEFAULT 'internal'
                              CHECK (type IN ('internal', 'external')),
  linked_epic_ids jsonb       NOT NULL DEFAULT '[]',
  note            text,
  created_by      text        NOT NULL DEFAULT 'pm',
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE roadmap_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_roadmap_milestones" ON roadmap_milestones
  FOR ALL USING (user_id = auth.uid()::text);

CREATE INDEX IF NOT EXISTS roadmap_milestones_user_id_idx     ON roadmap_milestones (user_id);
CREATE INDEX IF NOT EXISTS roadmap_milestones_instance_id_idx ON roadmap_milestones (instance_id);
CREATE INDEX IF NOT EXISTS roadmap_milestones_date_idx        ON roadmap_milestones (date);

-- ─── DONE ─────────────────────────────────────────────────────────────────────
-- Verify with:
--   SELECT COUNT(*) FROM roadmap_milestones;
