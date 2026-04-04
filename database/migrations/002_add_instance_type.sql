-- Migration 002 — Add instance_type to instances table
-- Run once in the Supabase SQL editor.
-- Safe on existing data: all existing instances default to 'pm'.

ALTER TABLE instances
  ADD COLUMN IF NOT EXISTS instance_type text NOT NULL DEFAULT 'pm'
  CHECK (instance_type IN ('pm', 'executive'));
