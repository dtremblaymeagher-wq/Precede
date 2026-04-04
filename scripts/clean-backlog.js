/**
 * clean-backlog.js — Remove backlog stories that don't belong to their instance's projectKey
 *
 * Dry run (show what would be deleted, no changes):
 *   node scripts/clean-backlog.js
 *
 * Apply deletions:
 *   node scripts/clean-backlog.js --delete
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const DRY_RUN = !process.argv.includes('--delete');

async function main() {
    console.log(DRY_RUN
        ? '🔍 DRY RUN — no changes will be made (pass --delete to apply)\n'
        : '🗑️  DELETE MODE — stories will be permanently removed\n'
    );

    // 1. Load all instances and their configured projectKey from integrations
    const { data: integrations, error: intErr } = await supabase
        .from('integrations')
        .select('user_id, instance_id, config');
    if (intErr) { console.error('Failed to load integrations:', intErr.message); process.exit(1); }

    // Build map: "userId/instanceId" → projectKey
    const configMap = new Map();
    for (const row of integrations || []) {
        const key = `${row.user_id}/${row.instance_id}`;
        const projectKey = row.config?.projectKey?.trim().toUpperCase() || null;
        if (projectKey) configMap.set(key, projectKey);
    }

    if (configMap.size === 0) {
        console.log('No Jira integrations found. Nothing to clean.');
        return;
    }

    console.log(`Found ${configMap.size} instance(s) with a configured projectKey:`);
    for (const [key, pk] of configMap) console.log(`  ${key} → ${pk}`);
    console.log();

    // 2. Load all backlog stories
    const { data: stories, error: stErr } = await supabase
        .from('backlog_stories')
        .select('filename, user_id, instance_id, data');
    if (stErr) { console.error('Failed to load backlog stories:', stErr.message); process.exit(1); }

    console.log(`Total stories in backlog: ${(stories || []).length}\n`);

    // 3. Find stories where data.projectKey doesn't match the instance's configured projectKey
    const toDelete = [];
    const skipped  = [];

    for (const story of stories || []) {
        const instanceKey   = `${story.user_id}/${story.instance_id}`;
        const configuredPK  = configMap.get(instanceKey);

        // No Jira config for this instance — skip (manual stories, other integrations)
        if (!configuredPK) continue;

        const storyPK = (story.data?.projectKey || story.data?.externalId?.split('-')[0] || '').toUpperCase();

        // No projectKey on story (manually created, not from Jira) — skip
        if (!storyPK) { skipped.push(story.filename); continue; }

        if (storyPK !== configuredPK) {
            toDelete.push({ filename: story.filename, storyPK, configuredPK, instanceKey });
        }
    }

    if (skipped.length > 0) {
        console.log(`ℹ️  Skipped ${skipped.length} manual story/stories (no projectKey) — untouched`);
    }

    if (toDelete.length === 0) {
        console.log('✅ No mismatched stories found. Backlog is clean.');
        return;
    }

    console.log(`⚠️  Found ${toDelete.length} mismatched story/stories:\n`);
    for (const s of toDelete) {
        console.log(`  ${s.filename}  [${s.storyPK}]  → instance expects [${s.configuredPK}]  (${s.instanceKey})`);
    }
    console.log();

    if (DRY_RUN) {
        console.log('Dry run complete. Run with --delete to remove these stories.');
        return;
    }

    // 4. Delete in batches
    const filenames = toDelete.map(s => s.filename);
    const { error: delErr } = await supabase
        .from('backlog_stories')
        .delete()
        .in('filename', filenames);

    if (delErr) {
        console.error('❌ Delete failed:', delErr.message);
        process.exit(1);
    }

    console.log(`✅ Deleted ${filenames.length} story/stories.`);
}

main().catch(e => { console.error(e); process.exit(1); });
