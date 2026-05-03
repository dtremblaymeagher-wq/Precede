-- Migration 010: Add delivery_mode and batch_id to api_usage_logs
-- delivery_mode: 'instant' (user waits for response) | 'batch' (background job)
-- batch_id: groups related batch calls (e.g. categorize + match in one epic analysis run)

ALTER TABLE api_usage_logs
  ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'instant',
  ADD COLUMN IF NOT EXISTS batch_id uuid;
