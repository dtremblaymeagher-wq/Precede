'use strict';
/**
 * seed-epic-history.js
 * Inserts synthetic historical epic data into backlog_stories so the
 * Predictive Engine (/api/engine/analysis) has enough completed epics
 * to compute a meaningful Reality Factor and inflation curve.
 *
 * Usage:
 *   node scripts/seed-epic-history.js <user_id> <instance_id>
 *   node scripts/seed-epic-history.js <user_id> <instance_id> --clean   ← remove seed rows
 *
 * Or set SEED_USER_ID + SEED_INSTANCE_ID in .env and run without args.
 *
 * 8 epics are created with varied size, scope creep timing, and friction:
 *
 *  Epic                       Stories   Creep     Pattern
 *  ─────────────────────────────────────────────────────────
 *  AUTH-REVAMP                6 → 8     +33%      late (sprint 75%)
 *  PAYMENT-GW                10 → 16   +60%      mid-lifecycle (~55%)
 *  DATA-EXPORT                8 → 22   +175%     early explosion (20-30%)
 *  MOBILE-REDESIGN           16 → 35   +119%     distributed + high friction
 *  API-RATE-LIMIT             5 → 6    +20%      minimal (nearly perfect scope)
 *  REPORTING-DASH            10 → 22   +120%     late heavy surge (70-80%)
 *  SEARCH-FEATURE             8 → 14   +75%      steady / even distribution
 *  SSO-INTEGRATION            6 → 12   +100%     high friction + late discovery
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const USER_ID     = process.env.SEED_USER_ID     || process.argv[2];
const INSTANCE_ID = process.env.SEED_INSTANCE_ID || process.argv[3];
const CLEAN       = process.argv.includes('--clean');

if (!USER_ID || !INSTANCE_ID) {
    console.error('\nUsage:  node scripts/seed-epic-history.js <user_id> <instance_id> [--clean]\n');
    console.error('  Or set SEED_USER_ID + SEED_INSTANCE_ID in .env\n');
    process.exit(1);
}

// ─── Story factory ─────────────────────────────────────────────────────────────

let _seq = 0;

function makeStory({ epicKey, epicName, title, sprintId, points }) {
    _seq++;
    return {
        user_id:       USER_ID,
        instance_id:   INSTANCE_ID,
        filename:      `seed_${epicKey}_${String(_seq).padStart(4, '0')}`,
        display_order: 9000 + _seq,             // above real stories to avoid conflicts
        data: {
            externalId:     `SEED-${epicKey}-${_seq}`,
            source:         'seed',             // tag for --clean removal
            title,
            status:         'Done',             // all historical stories are done
            epicKey,
            epicName,
            sprintId,                           // numeric — used by sprintIdx()
            sprintName:     `Sprint ${sprintId}`,
            sprintState:    'closed',           // no active flag → epicComplete() passes
            importedEffort: points,
            labels:         [],
            issueType:      'Story',
            priority:       'Medium',
        },
    };
}

// ─── Epic builder ──────────────────────────────────────────────────────────────
// distribution: [{ sprintId, stories: [{ title, points }] }]
// All stories are marked Done + closed → engine reads this epic as completed.

function buildEpic(epicKey, epicName, distribution) {
    const rows = [];
    for (const { sprintId, stories } of distribution) {
        for (const { title, points } of stories) {
            rows.push(makeStory({ epicKey, epicName, title, sprintId, points }));
        }
    }
    return rows;
}

// ─── Epic 1: AUTH-REVAMP ───────────────────────────────────────────────────────
// Small (6 → 8 stories). Tight scope. 2 stories appear late at 75% lifecycle.
// Pattern: minimal creep, mainly late security findings.
const E1 = buildEpic('AUTH-REVAMP', 'User Authentication Revamp', [
    { sprintId: 2, stories: [
        { title: 'Design new auth flow',          points: 5 },
        { title: 'Implement JWT refresh tokens',  points: 8 },
        { title: 'Add TOTP / MFA support',        points: 5 },
    ]},
    { sprintId: 3, stories: [
        { title: 'Session management service',    points: 3 },
        { title: 'Login rate limiting',           points: 2 },
    ]},
    { sprintId: 4, stories: [
        { title: 'Audit log integration',         points: 3 },   // ← scope crept in
    ]},
    { sprintId: 5, stories: [
        { title: 'Security pen-test remediation', points: 5 },   // ← late discovery
    ]},
]);

// ─── Epic 2: PAYMENT-GW ───────────────────────────────────────────────────────
// Medium (10 → 16 stories). Mid-lifecycle creep discovered at ~55% (sprint 10-11).
// Classic: integration looked simpler than it was.
const E2 = buildEpic('PAYMENT-GW', 'Payment Gateway Integration', [
    { sprintId: 5, stories: [
        { title: 'Stripe SDK integration',        points: 5 },
        { title: 'Checkout flow UI',              points: 8 },
        { title: 'Webhook event handler',         points: 5 },
        { title: 'Payment method storage',        points: 3 },
    ]},
    { sprintId: 6, stories: [
        { title: 'Refund processing flow',        points: 5 },
        { title: 'Invoice PDF generation',        points: 3 },
    ]},
    { sprintId: 7, stories: [
        { title: '3DS authentication support',    points: 8 },
    ]},
    // ── Mid-lifecycle creep (sprint 10-11 ≈ 55%) ──────────────────────────
    { sprintId: 10, stories: [
        { title: 'PayPal fallback integration',   points: 8 },
        { title: 'Multi-currency support',        points: 5 },
        { title: 'Tax calculation module',        points: 5 },
    ]},
    { sprintId: 11, stories: [
        { title: 'Idempotency keys',              points: 2 },
        { title: 'Payment retry logic',           points: 3 },
    ]},
    { sprintId: 12, stories: [
        { title: 'Finance reconciliation export', points: 3 },
        { title: 'PCI compliance audit',          points: 5 },
    ]},
    { sprintId: 13, stories: [
        { title: 'End-to-end payment test suite', points: 5 },
    ]},
]);

// ─── Epic 3: DATA-EXPORT ──────────────────────────────────────────────────────
// Large (8 → 22 stories). Early scope explosion at 20-30%: discovery sprint
// revealed the initial estimate was badly under-scoped.
const E3 = buildEpic('DATA-EXPORT', 'Data Export Module', [
    { sprintId: 8, stories: [
        { title: 'CSV export endpoint',           points: 3 },
        { title: 'Background export job queue',   points: 5 },
        { title: 'Export progress tracking UI',   points: 3 },
    ]},
    // ── Early explosion (sprint 9-10 ≈ 20-30%) ────────────────────────────
    { sprintId: 9, stories: [
        { title: 'PDF report generation',         points: 8 },
        { title: 'Excel / XLSX format support',   points: 5 },
        { title: 'Scheduled export jobs',         points: 5 },
    ]},
    { sprintId: 10, stories: [
        { title: 'Custom column mapping UI',      points: 8 },
        { title: 'Large dataset streaming',       points: 8 },
        { title: 'Export history view',           points: 3 },
        { title: 'Email delivery of exports',     points: 3 },
    ]},
    { sprintId: 11, stories: [
        { title: 'S3 cloud storage connector',    points: 5 },
        { title: 'Export file encryption',        points: 5 },
        { title: 'Audit trail for exports',       points: 3 },
    ]},
    { sprintId: 14, stories: [
        { title: 'Performance optimization',      points: 5 },
        { title: 'Per-user rate limiting',        points: 2 },
    ]},
    { sprintId: 15, stories: [
        { title: 'Admin export dashboard',        points: 5 },
        { title: 'Reusable export templates',     points: 3 },
    ]},
    { sprintId: 17, stories: [
        { title: 'Final QA and regression',       points: 3 },
    ]},
]);

// ─── Epic 4: MOBILE-REDESIGN ──────────────────────────────────────────────────
// XL (16 → 35 stories). Distributed creep + high friction.
// Multiple stagnation gaps (sprints 14, 17, 21 have no completions).
const E4 = buildEpic('MOBILE-REDESIGN', 'Mobile App Redesign', [
    { sprintId: 12, stories: [
        { title: 'New design system setup',       points: 8 },
        { title: 'Component library migration',   points: 8 },
        { title: 'Navigation refactor',           points: 5 },
        { title: 'Home screen redesign',          points: 5 },
    ]},
    { sprintId: 13, stories: [
        { title: 'Profile screen v2',             points: 5 },
        { title: 'Settings screen v2',            points: 3 },
    ]},
    // Sprint 14: no completions (blocked by design review — friction)
    { sprintId: 15, stories: [
        { title: 'Feed redesign',                 points: 8 },
        { title: 'Story cards v2',                points: 5 },
        { title: 'Notification center',           points: 5 },
    ]},
    { sprintId: 16, stories: [
        { title: 'Search UX overhaul',            points: 5 },
        { title: 'Filter UI redesign',            points: 3 },
    ]},
    // Sprint 17: blocked by API changes (friction)
    { sprintId: 18, stories: [
        { title: 'Onboarding flow redesign',      points: 8 },
        { title: 'Empty state illustrations',     points: 3 },
        { title: 'Dark mode support',             points: 8 },
    ]},
    // ── Mid-lifecycle creep (sprint 19 ≈ 50%) ─────────────────────────────
    { sprintId: 19, stories: [
        { title: 'Accessibility audit fixes',     points: 5 },
        { title: 'Animation micro-library',       points: 5 },
        { title: 'Haptic feedback system',        points: 3 },
    ]},
    { sprintId: 20, stories: [
        { title: 'Performance profiling',         points: 5 },
        { title: 'Image lazy loading',            points: 3 },
    ]},
    // Sprint 21: unplanned scope freeze (friction)
    { sprintId: 22, stories: [
        { title: 'A/B test framework integration', points: 5 },
        { title: 'Analytics event tracking',      points: 3 },
        { title: 'Crash reporting integration',   points: 3 },
    ]},
    { sprintId: 23, stories: [
        { title: 'Beta feedback fixes',           points: 5 },
        { title: 'App Store listing assets',      points: 2 },
    ]},
    // ── Late creep (sprint 24-25 ≈ 85%) ──────────────────────────────────
    { sprintId: 24, stories: [
        { title: 'iPad layout support',           points: 8 },
        { title: 'Landscape mode fixes',          points: 5 },
    ]},
    { sprintId: 25, stories: [
        { title: 'Localization support',          points: 8 },
        { title: 'RTL layout fixes',              points: 5 },
    ]},
    { sprintId: 26, stories: [
        { title: 'App Store review fixes',        points: 3 },
        { title: 'Final regression testing',      points: 3 },
    ]},
]);

// ─── Epic 5: API-RATE-LIMIT ───────────────────────────────────────────────────
// Small (5 → 6 stories). Nearly perfect scoping. 1 minor late addition.
const E5 = buildEpic('API-RATE-LIMIT', 'API Rate Limiting', [
    { sprintId: 15, stories: [
        { title: 'Redis rate limiter middleware',  points: 5 },
        { title: 'Per-endpoint config system',    points: 3 },
        { title: 'IP-based burst limits',         points: 3 },
    ]},
    { sprintId: 16, stories: [
        { title: '429 response + Retry-After header', points: 2 },
        { title: 'Rate limit dashboard for admins',   points: 3 },
    ]},
    { sprintId: 17, stories: [
        { title: 'Admin override system',         points: 2 },   // ← small late addition
    ]},
]);

// ─── Epic 6: REPORTING-DASH ───────────────────────────────────────────────────
// Medium-large (10 → 22 stories). Classic "80% syndrome":
// stakeholder demo at sprint 23 triggered a burst of new requirements.
const E6 = buildEpic('REPORTING-DASH', 'Reporting Dashboard', [
    { sprintId: 18, stories: [
        { title: 'Dashboard shell + routing',     points: 5 },
        { title: 'KPI summary cards',             points: 3 },
        { title: 'Date range picker',             points: 3 },
    ]},
    { sprintId: 19, stories: [
        { title: 'Revenue over time chart',       points: 5 },
        { title: 'User growth chart',             points: 5 },
        { title: 'Data caching layer',            points: 8 },
    ]},
    { sprintId: 20, stories: [
        { title: 'Export to PDF',                 points: 5 },
        { title: 'Scheduled email reports',       points: 5 },
    ]},
    { sprintId: 21, stories: [
        { title: 'Drill-down by segment',         points: 5 },
        { title: 'Comparison mode (YoY)',         points: 3 },
    ]},
    // ── Late surge (sprint 23-25 ≈ 70-90%) — post-demo scope explosion ────
    { sprintId: 23, stories: [
        { title: 'Custom dashboard builder',      points: 13 },
        { title: 'Widget drag-and-drop',          points: 8 },
        { title: 'Share dashboard link',          points: 3 },
    ]},
    { sprintId: 24, stories: [
        { title: 'Executive summary view',        points: 5 },
        { title: 'Benchmark comparisons',         points: 5 },
        { title: 'Goal tracking overlay',         points: 5 },
    ]},
    { sprintId: 25, stories: [
        { title: 'Embedded reporting API',        points: 8 },
        { title: 'White-label option',            points: 5 },
    ]},
    { sprintId: 26, stories: [
        { title: 'Performance tuning',            points: 5 },
        { title: 'QA sign-off + bug fixes',       points: 3 },
    ]},
]);

// ─── Epic 7: SEARCH-FEATURE ───────────────────────────────────────────────────
// Medium (8 → 14 stories). Steady, even scope creep distributed across lifecycle.
const E7 = buildEpic('SEARCH-FEATURE', 'Search Functionality', [
    { sprintId: 20, stories: [
        { title: 'Elasticsearch integration',     points: 8 },
        { title: 'Full-text search API',          points: 5 },
        { title: 'Search results UI',             points: 5 },
    ]},
    { sprintId: 21, stories: [
        { title: 'Autocomplete suggestions',      points: 5 },
        { title: 'Search filter sidebar',         points: 5 },
    ]},
    { sprintId: 22, stories: [                    // ~40% through
        { title: 'Fuzzy matching support',        points: 5 },
        { title: 'Search analytics events',       points: 3 },
    ]},
    { sprintId: 23, stories: [                    // ~60% through
        { title: 'Saved searches',                points: 3 },
    ]},
    { sprintId: 24, stories: [                    // ~80% through
        { title: 'Advanced filter UI',            points: 5 },
        { title: 'Query suggestions (ML)',        points: 8 },
    ]},
    { sprintId: 25, stories: [
        { title: 'Search index performance tuning', points: 3 },
    ]},
]);

// ─── Epic 8: SSO-INTEGRATION ──────────────────────────────────────────────────
// Medium (6 → 12 stories). High friction (blocked sprints 17-19, 21)
// plus late scope discovery driven by compliance requirements.
const E8 = buildEpic('SSO-INTEGRATION', 'SSO & SAML Integration', [
    { sprintId: 16, stories: [
        { title: 'SAML library evaluation',       points: 3 },
        { title: 'IdP connector scaffold',        points: 5 },
    ]},
    // Sprints 17-19: blocked pending security review (friction — no stories)
    { sprintId: 20, stories: [
        { title: 'SAML response parsing',         points: 8 },
        { title: 'SP metadata endpoint',          points: 3 },
    ]},
    // Sprint 21: blocked again (friction)
    { sprintId: 22, stories: [
        { title: 'Okta integration',              points: 5 },
        { title: 'Azure AD integration',          points: 5 },
    ]},
    { sprintId: 23, stories: [
        { title: 'JIT user provisioning',         points: 5 },
        { title: 'Role mapping engine',           points: 5 },
    ]},
    // ── Late discovery (sprint 24 ≈ 80%) ──────────────────────────────────
    { sprintId: 24, stories: [
        { title: 'SCIM provisioning support',     points: 8 },
        { title: 'Session binding edge cases',    points: 3 },
    ]},
    { sprintId: 25, stories: [
        { title: 'Security audit remediation',    points: 5 },
        { title: 'Compliance documentation',      points: 2 },
    ]},
]);

// ─── Clean mode ────────────────────────────────────────────────────────────────

async function clean() {
    console.log('\n🗑️  Removing seeded stories (source = "seed")…\n');

    const { data, error } = await supabase
        .from('backlog_stories')
        .delete()
        .eq('user_id',     USER_ID)
        .eq('instance_id', INSTANCE_ID)
        .eq('data->>source', 'seed')
        .select('id');

    if (error) { console.error('❌ Clean failed:', error.message); process.exit(1); }
    console.log(`✅ Removed ${(data || []).length} seeded rows.\n`);
}

// ─── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
    const allEpics = [
        { key: 'AUTH-REVAMP',     rows: E1 },
        { key: 'PAYMENT-GW',     rows: E2 },
        { key: 'DATA-EXPORT',    rows: E3 },
        { key: 'MOBILE-REDESIGN',rows: E4 },
        { key: 'API-RATE-LIMIT', rows: E5 },
        { key: 'REPORTING-DASH', rows: E6 },
        { key: 'SEARCH-FEATURE', rows: E7 },
        { key: 'SSO-INTEGRATION',rows: E8 },
    ];

    const allRows = allEpics.flatMap(e => e.rows);

    console.log('\n📊 Epic Lifecycle Seed\n');
    console.log(`  User:      ${USER_ID}`);
    console.log(`  Instance:  ${INSTANCE_ID}`);
    console.log(`  Stories:   ${allRows.length} total\n`);

    // Print preview table
    console.log('  Epic                        Stories  Sprints       Scope creep');
    console.log('  ─────────────────────────────────────────────────────────────────');
    for (const { key, rows } of allEpics) {
        const sprints  = [...new Set(rows.map(r => r.data.sprintId))].sort((a,b) => a-b);
        const initThr  = sprints[0] + Math.max(1, (sprints[sprints.length-1] - sprints[0]) * 0.10);
        const initial  = rows.filter(r => r.data.sprintId <= initThr).length;
        const creepPct = initial > 0 ? Math.round(((rows.length - initial) / initial) * 100) : 0;
        const sprintRange = `${sprints[0]}–${sprints[sprints.length-1]}`;
        console.log(`  ${key.padEnd(28)} ${String(rows.length).padEnd(9)}Sprint ${sprintRange.padEnd(11)} +${creepPct}%`);
    }
    console.log('');

    // Batch insert
    const BATCH = 50;
    let inserted = 0;
    for (let i = 0; i < allRows.length; i += BATCH) {
        const batch = allRows.slice(i, i + BATCH);
        const { error } = await supabase.from('backlog_stories').insert(batch);
        if (error) {
            console.error(`\n❌ Insert failed at row ${i}:`, error.message);
            process.exit(1);
        }
        inserted += batch.length;
        process.stdout.write(`\r  Inserting… ${inserted}/${allRows.length}`);
    }

    console.log(`\n\n✅ Done. Restart the server then open /epic-lifecycle.html to see the analysis.\n`);
    console.log('  To remove seed data later:');
    console.log(`  node scripts/seed-epic-history.js ${USER_ID} ${INSTANCE_ID} --clean\n`);
}

// ─── Entry point ───────────────────────────────────────────────────────────────

(CLEAN ? clean() : seed()).catch(err => {
    console.error('\n❌ Fatal:', err.message);
    process.exit(1);
});
