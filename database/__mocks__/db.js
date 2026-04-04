'use strict';
/**
 * database/__mocks__/db.js
 *
 * Jest manual mock for the Supabase client.
 * Supports two queuing modes — mix freely within a test:
 *
 *   GLOBAL (positional):
 *     db.__q([ resp0, resp1, resp2 ])
 *     Each DB call (any table) consumes the next slot in order.
 *     resolveInstance always occupies slot 0 on protected routes.
 *
 *   PER-TABLE (resilient):
 *     db.__qTable('settings', [ resp0, resp1 ])
 *     Calls on that specific table consume from its own queue.
 *     Other tables still fall back to the global queue.
 *     Adding a new DB call to a route only breaks tests that
 *     use the same table without __qTable — not everything.
 *
 * Best practice for new tests: use __qTable for every table the route
 * touches so tests are order-independent.
 *
 *   db.__qTable('instances',          [instanceOk()]);          // resolveInstance
 *   db.__qTable('settings',           [{ data: {...}, error: null }]);
 *   db.__qTable('backlog_stories',    [{ data: [...], error: null }]);
 */

const state = { queue: [], idx: 0, tables: {} };

function next(table) {
    // Per-table queue takes priority if populated
    const tq = state.tables[table];
    if (tq && tq.length > 0) return Promise.resolve(tq.shift());
    // Fall back to global positional queue
    return Promise.resolve(state.queue[state.idx++] ?? { data: null, error: null });
}

function chain(table) {
    const c = {
        select: () => c, insert: () => c, update: () => c, upsert: () => c, delete: () => c,
        eq: () => c, neq: () => c, like: () => c, gt: () => c, gte: () => c, lte: () => c,
        filter: () => c, order: () => c, limit: () => c, in: () => c,
        single:      () => next(table),
        maybeSingle: () => next(table),
        then:        (res, rej) => next(table).then(res, rej),
    };
    return c;
}

module.exports = {
    from:     (table) => chain(table),

    /** Global positional queue — backward-compatible with all existing tests. */
    __q:      (responses) => { state.queue = responses; state.idx = 0; },

    /** Per-table queue — resilient to unrelated DB calls added to the same route. */
    __qTable: (table, responses) => { state.tables[table] = [...responses]; },

    __reset:  () => { state.queue = []; state.idx = 0; state.tables = {}; },
};
