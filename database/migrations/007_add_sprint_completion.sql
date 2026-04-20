-- Migration 007: add instance_id + completion stats to sprints table
-- Enables per-instance sprint predictability using Jira Agile API data.

ALTER TABLE sprints ADD COLUMN IF NOT EXISTS instance_id uuid REFERENCES instances(id);
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS completed_count integer;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS total_count     integer;

CREATE INDEX IF NOT EXISTS sprints_instance_id_idx ON sprints (instance_id);
