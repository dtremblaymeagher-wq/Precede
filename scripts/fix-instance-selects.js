/**
 * scripts/fix-instance-selects.js
 *
 * Replaces all Supabase SELECT chains that filter by user_id + instance_id
 * with the instanceSelect() helper.
 *
 * Three format variants are handled:
 *   Format 1 (5-line): supabase / .from() / .select() / .eq(user) / .eq(instance)
 *   Format 2 (2-line): supabase / .from().select().eq(user).eq(instance)
 *   Format 3 (1-line): supabase.from().select().eq(user).eq(instance)
 *
 * Run: node scripts/fix-instance-selects.js
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'server.js');
let src = fs.readFileSync(FILE, 'utf8');
const original = src;

// Replacement factory
const repl = (t, c, i) => `instanceSelect(${t}, ${c}, userId, ${i})`;

const NL = /\r?\n/;    // matches both LF and CRLF
const ws = /[ \t]*/;  // horizontal whitespace only (no newlines)
const WS = /[ \t]+/;

// Format 1 — 5 separate lines (most common)
src = src.replace(
    /supabase\r?\n[ \t]+\.from\(('[\w_]+')\)\r?\n[ \t]+\.select\(('[^']*')\)\r?\n[ \t]+\.eq\('user_id',[ \t]*userId\)\r?\n[ \t]+\.eq\('instance_id',[ \t]*(req\.instanceId|instanceId)\)/g,
    (_, t, c, i) => repl(t, c, i)
);

// Format 2 — supabase on first line, full chain on second line
src = src.replace(
    /supabase\r?\n[ \t]+\.from\(('[\w_]+')\)\.select\(('[^']*')\)\.eq\('user_id',[ \t]*userId\)\.eq\('instance_id',[ \t]*(req\.instanceId|instanceId)\)/g,
    (_, t, c, i) => repl(t, c, i)
);

// Format 3 — fully single line
src = src.replace(
    /supabase\.from\(('[\w_]+')\)\.select\(('[^']*')\)\.eq\('user_id',[ \t]*userId\)\.eq\('instance_id',[ \t]*(req\.instanceId|instanceId)\)/g,
    (_, t, c, i) => repl(t, c, i)
);

const countBefore = (original.match(/\.eq\('user_id',\s*userId\)\n?\s*\.eq\('instance_id'/g) || []).length;
const countAfter  = (src.match(/\.eq\('user_id',\s*userId\)\n?\s*\.eq\('instance_id'/g) || []).length;
console.log(`Patterns replaced: ${countBefore - countAfter}`);
console.log(`Patterns remaining: ${countAfter}`);

fs.writeFileSync(FILE, src);
console.log('Done.');
