/**
 * shared/design-tokens.js  —  Browser design tokens (loaded via <script> tag)
 *
 * Exposes COLORS and THRESHOLDS as globals for dashboard.js / dashboard-ph.js.
 * Single source of truth for all colors and score thresholds in the UI.
 */

/* eslint-disable no-unused-vars */

// ── Color palette ─────────────────────────────────────────────────────────────
const COLORS = Object.freeze({
    // Semantic
    success:     '#5a8c62',  // green  — strong, on-track, healthy
    successAlt:  '#4a8c54',  // green  — alternative (diversity charts, sync status)
    danger:      '#9c3c3c',  // red    — at risk, declining, error
    warning:     '#b08840',  // amber  — mixed, moderate, caution
    warningAlt:  '#a07830',  // ochre  — alternative amber (signal badges)
    accent:      '#b05a38',  // rust   — primary action, links
    accentLight: '#c47a5a',  // light rust — gradient end stop

    // Text
    textPrimary:   '#2c2318',  // dark brown — headings, primary labels
    textSecondary: '#8c7d6a',  // taupe      — secondary labels, metadata
    textMuted:     '#b0a090',  // muted taupe — placeholders, minor notes

    // Surfaces & borders
    border:  '#e0d8cc',  // warm beige — dividers, card borders
    hoverBg: '#ede7dc',  // light beige — hover/active background
    bgLight: '#f5f0e8',  // off-white   — section backgrounds
});

// ── Score & coverage thresholds ───────────────────────────────────────────────
const THRESHOLDS = Object.freeze({
    scoreHigh:    70,  // score >= 70 → green (strong)
    scoreMid:     40,  // score >= 40 → amber (moderate); < 40 → red (at risk)
    coverageHigh: 30,  // coverage % >= 30 → green
    coverageLow:  10,  // coverage % >= 10 → amber; < 10 → red
    syncFreshDays:  7, // last sync <= 7 days → green
    syncWarnDays:  14, // last sync <= 14 days → amber; > 14 → red
});
