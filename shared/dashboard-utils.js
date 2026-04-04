/**
 * shared/dashboard-utils.js
 * Utilities shared between dashboard.js and the product-health widgets.
 * Loaded before both via <script src="/shared/dashboard-utils.js">.
 */

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
