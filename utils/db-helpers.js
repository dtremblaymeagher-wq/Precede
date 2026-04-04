'use strict';
/**
 * utils/db-helpers.js
 *
 * Factory that returns instance-scoped Supabase query helpers bound to a
 * given supabase client. Used by route files to avoid duplicating the
 * .eq('user_id') / .eq('instance_id') chain everywhere.
 */

function makeHelpers(supabase) {
    /** Chainable SELECT pre-filtered to user + instance. */
    const instanceSelect = (table, cols, userId, instanceId) =>
        supabase.from(table).select(cols).eq('user_id', userId).eq('instance_id', instanceId);

    /** UPSERT scoped to user + instance (conflict key: user_id,instance_id). */
    const instanceUpsert = (table, payload, userId, instanceId) =>
        supabase.from(table).upsert(
            { user_id: userId, instance_id: instanceId, ...payload },
            { onConflict: 'user_id,instance_id' }
        );

    /** INSERT scoped to user + instance. */
    const instanceInsert = (table, row, userId, instanceId) =>
        supabase.from(table).insert({ user_id: userId, instance_id: instanceId, ...row });

    return { instanceSelect, instanceUpsert, instanceInsert };
}

module.exports = { makeHelpers };
