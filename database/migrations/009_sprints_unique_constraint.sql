-- Migration 009: remove duplicate sprint rows and add unique constraint.
-- Keeps the row with the highest updated_at (most recent sync) per user+jira_id pair.

DELETE FROM sprints
WHERE id NOT IN (
    SELECT DISTINCT ON (user_id, jira_id) id
    FROM sprints
    ORDER BY user_id, jira_id, updated_at DESC NULLS LAST
);

CREATE UNIQUE INDEX IF NOT EXISTS sprints_user_jira_unique ON sprints (user_id, jira_id);
