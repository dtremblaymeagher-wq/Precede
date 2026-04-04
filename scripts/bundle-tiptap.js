/**
 * Bundles Tiptap into a single browser-ready IIFE at shared/tiptap-bundle.js
 * Run: node scripts/bundle-tiptap.js
 */
const esbuild = require('esbuild');
const path    = require('path');

esbuild.build({
    entryPoints: [path.join(__dirname, 'tiptap-entry.js')],
    bundle:      true,
    outfile:     path.join(__dirname, '../shared/tiptap-bundle.js'),
    format:      'iife',
    platform:    'browser',
    minify:      false,
    target:      ['es2017'],
}).then(() => {
    console.log('✅  shared/tiptap-bundle.js built successfully');
}).catch(err => {
    console.error('❌  Tiptap bundle failed:', err.message);
    process.exit(1);
});
