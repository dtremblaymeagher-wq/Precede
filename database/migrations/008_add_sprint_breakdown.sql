-- Migration 008: add added/removed/rollover counts to sprints table
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS added_count   integer;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS removed_count integer;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS rollover_count integer;
