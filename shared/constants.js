'use strict';
/**
 * shared/constants.js  —  Server-side business logic constants
 *
 * Single source of truth for all thresholds used in analysis, velocity
 * modelling, and confidence calculations.
 *
 * Usage:  const { TEMPORAL, LONGITUDINAL, VELOCITY } = require('../shared/constants');
 */

// ── Temporal signal weights ──────────────────────────────────────────────────
// Used by the Radar analysis pipeline to weight intelligence entries by age.
const TEMPORAL = Object.freeze({
    HIGH_DAYS:   14,  // <= 14 days  → 'high'   weight
    MEDIUM_DAYS: 60,  // <= 60 days  → 'medium' weight; > 60 → 'background'
});

// ── Longitudinal analysis trigger ────────────────────────────────────────────
// Auto-triggers deep longitudinal analysis once there is enough sprint history.
const LONGITUDINAL = Object.freeze({
    MIN_SPRINTS: 4,   // need at least 4 sprints of data
    MIN_DAYS:   49,   // spanning at least 49 days
});

// ── Roadmap velocity model ────────────────────────────────────────────────────
const VELOCITY = Object.freeze({
    // Fraction of team velocity allocated to each priority rank (P1 … P4+).
    // Must sum to 1.0.
    PRIORITY_SHARES: [0.48, 0.29, 0.16, 0.07],

    // Default scope-creep multipliers per epic phase (until team history emerges).
    DEFAULT_CREEP: Object.freeze({
        discovery:   0.50,  // 50% story growth per sprint in discovery
        refinement:  0.20,
        development: 0.10,
        completion:  0.03,
    }),

    // Confidence interval parameters for sprint projections.
    CONFIDENCE: Object.freeze({
        likelyMax:  85,   // ceiling for likely-case confidence %
        likelyMin:  20,   // floor  for likely-case confidence %
        spreadFactor: 8,  // confidence drop per sprint of spread
        bestBonus:  15,   // best-case adds this to likely confidence
        bestMax:    95,   // ceiling for best-case confidence %
        worstFixed: 90,   // worst-case confidence is always 90 %
    }),
});

// ── AI rate limiter ───────────────────────────────────────────────────────────
const RATE_LIMIT = Object.freeze({
    WINDOW_MINUTES: 15,
    MAX_REQUESTS:   60,
});

module.exports = { TEMPORAL, LONGITUDINAL, VELOCITY, RATE_LIMIT };
