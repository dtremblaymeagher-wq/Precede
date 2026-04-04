'use strict';
/**
 * scripts/apply-tokens.js
 *
 * One-shot script: replaces hardcoded hex colors and score thresholds
 * in dashboard.js and dashboard-ph.js with design token references.
 *
 * Run once: node scripts/apply-tokens.js
 */

const fs = require('fs');
const path = require('path');

// ── Color token map ──────────────────────────────────────────────────────────
const COLORS = {
    '#5a8c62': 'COLORS.success',
    '#9c3c3c': 'COLORS.danger',
    '#b08840': 'COLORS.warning',
    '#4a8c54': 'COLORS.successAlt',
    '#a07830': 'COLORS.warningAlt',
    '#b05a38': 'COLORS.accent',
    '#2c2318': 'COLORS.textPrimary',
    '#8c7d6a': 'COLORS.textSecondary',
    '#b0a090': 'COLORS.textMuted',
    '#e0d8cc': 'COLORS.border',
    '#ede7dc': 'COLORS.hoverBg',
    '#f5f0e8': 'COLORS.bgLight',
};

// Hex regex (only the specific colors we're tracking)
const hexPattern = new RegExp(Object.keys(COLORS).map(h => h.replace('#', '#')).join('|'), 'gi');

function tokenFor(hex) {
    return COLORS[hex.toLowerCase()];
}

// ── Replacement logic ────────────────────────────────────────────────────────

function processFile(filepath) {
    let src = fs.readFileSync(filepath, 'utf8');
    const orig = src;
    let changes = 0;

    // Pass 1: standalone quoted hex values → bare token
    // e.g. '#9c3c3c' → COLORS.danger   (both single and double quotes)
    src = src.replace(/'(#[0-9a-fA-F]{6})'/g, (_, hex) => {
        const t = tokenFor(hex);
        if (!t) return _;
        changes++;
        return t;
    });
    src = src.replace(/"(#[0-9a-fA-F]{6})"/g, (_, hex) => {
        const t = tokenFor(hex);
        if (!t) return _;
        changes++;
        return t;
    });

    // Pass 2: single-quoted strings that contain a hex inside HTML
    // e.g. '<span style="color:#9c3c3c">' → `<span style="color:${COLORS.danger}">`
    src = src.replace(/'([^'\n]*#[0-9a-fA-F]{6}[^'\n]*)'/g, (match, inner) => {
        if (!hexPattern.test(inner)) return match;
        hexPattern.lastIndex = 0;
        const replaced = inner.replace(hexPattern, h => {
            const t = tokenFor(h);
            if (!t) return h;
            changes++;
            return `\${${t}}`;
        });
        return `\`${replaced}\``;
    });

    // Pass 3: remaining hex in template literals → ${COLORS.xxx}
    // (hex not already inside ${...})
    src = src.replace(/#[0-9a-fA-F]{6}/g, hex => {
        const t = tokenFor(hex);
        if (!t) return hex;
        changes++;
        return `\${${t}}`;
    });

    if (changes === 0) {
        console.log(`  ${path.basename(filepath)}: nothing to replace`);
        return;
    }

    fs.writeFileSync(filepath, src, 'utf8');
    console.log(`  ${path.basename(filepath)}: ${changes} replacements`);
}

// ── Run ──────────────────────────────────────────────────────────────────────
const root = path.join(__dirname, '..');
['dashboard.js', 'dashboard-ph.js'].forEach(f => processFile(path.join(root, f)));
console.log('\nDone. Reload the server to verify.');
