-- ============================================================
-- Migration 006 — Epic predictions table
-- Stores AI-generated T-shirt size + epic type categorization
-- for both completed (historical) and active epics, plus
-- PM overrides and similarity-matching results.
--
-- Run once in the Supabase SQL editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS epic_predictions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text        NOT NULL,
  instance_id     uuid        NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  epic_key        text        NOT NULL,
  epic_name       text,

  -- ── AI categorization ───────────────────────────────────────
  -- tshirt_size:  XS / S / M / L / XL / XXL
  -- epic_type:    feature / integration / refactor / ux / data / infra / security
  -- rationale:    one sentence from Claude explaining the classification
  tshirt_size     text        CHECK (tshirt_size  IN ('XS','S','M','L','XL','XXL')),
  epic_type       text        CHECK (epic_type    IN ('feature','integration','refactor','ux','data','infra','security')),
  rationale       text,

  -- ── PM override (always takes priority over AI) ─────────────
  tshirt_override text        CHECK (tshirt_override IN ('XS','S','M','L','XL','XXL')),
  type_override   text        CHECK (type_override   IN ('feature','integration','refactor','ux','data','infra','security')),
  override_note   text,
  overridden_at   timestamptz,

  -- ── Matching (populated for active epics) ───────────────────
  -- confidence_level: precise_match / type_expanded / size_only / insufficient
  -- matched_epic_keys: ordered array of matched completed epic keys
  -- scope_projection:  { additionalStories, creepPct, fromPhase, basedOnEpics }
  confidence_level  text      CHECK (confidence_level IN (
                                'precise_match','type_expanded','size_only','insufficient'
                              )),
  matched_epic_keys jsonb     NOT NULL DEFAULT '[]',
  scope_projection  jsonb,

  -- ── Cache invalidation ───────────────────────────────────────
  -- stories_hash: fingerprint of (story count + sorted labels)
  -- If hash unchanged, skip recalculation.
  stories_hash    text,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, instance_id, epic_key)
);

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE epic_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_epic_predictions" ON epic_predictions
  FOR ALL USING (user_id = auth.uid()::text);

-- ── Indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS epic_predictions_user_instance_idx
  ON epic_predictions (user_id, instance_id);

CREATE INDEX IF NOT EXISTS epic_predictions_epic_key_idx
  ON epic_predictions (user_id, instance_id, epic_key);

CREATE INDEX IF NOT EXISTS epic_predictions_computed_at_idx
  ON epic_predictions (computed_at DESC);

-- ─── DONE ──────────────────────────────────────────────────────
-- Verify with:
--   SELECT COUNT(*) FROM epic_predictions;
--   \d epic_predictions
