'use strict';
/**
 * shared/solution-transfer.js — Central transfer command
 *
 * Single source of truth for moving items from any selection context
 * (drilldown panel, data archive) to Brainstorm or Decision Log.
 *
 * ── Standard SolutionItem shape ──────────────────────────────────────────────
 * {
 *   id:          string,
 *   widget:      string,   // source label (e.g. "OKR Alignment", "Data Archive")
 *   title:       string,
 *   description: string,   // plain text
 *   sources:     Array<{ label: string, value?: string, tag?: string }>,
 *   details:     Array<{ label: string, value: string }>,
 *   capturedAt:  string    // ISO timestamp
 * }
 *
 * ── localStorage contracts ────────────────────────────────────────────────────
 *   selectedBrainstormItems  → SolutionItem[]
 *   pendingDecision          → { items: SolutionItem[], name, date, approver }
 */

window.SolutionTransfer = (() => {

    // ── Converters ────────────────────────────────────────────────────────────

    /**
     * Build a SolutionItem from a DrillDown.open() payload.
     * Node values in details are skipped (not serialisable).
     */
    function fromDrillDown(payload = {}) {
        return {
            id:          'dd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            widget:      payload.label       || '',
            title:       payload.title       || '',
            description: _toPlainText(payload.description),
            sources:     (payload.sources || []).map(s => ({
                label: s.label,
                ...(s.value != null && { value: s.value }),
                ...(s.tag   != null && { tag:   s.tag   }),
            })),
            details:     (payload.details || [])
                .filter(d => !(d.value instanceof Node))
                .map(d => ({ label: d.label, value: String(d.value ?? '') })),
            capturedAt:  new Date().toISOString(),
        };
    }

    /**
     * Build a SolutionItem from a data-archive entry object.
     */
    function fromArchiveEntry(entry) {
        if (!entry) return null;
        return {
            id:          'arc_' + entry.id,
            widget:      'Data Archive',
            title:       [entry.sourceType, entry.person].filter(Boolean).join(' · ') || 'Entry',
            description: entry.body || '',
            sources:     [],
            details:     [
                entry.person       ? { label: 'From',   value: entry.person }             : null,
                entry.sourceType   ? { label: 'Source', value: entry.sourceType }         : null,
                entry.date         ? { label: 'Date',   value: entry.date }               : null,
                entry.tags?.length ? { label: 'Tags',   value: entry.tags.join(', ') }   : null,
            ].filter(Boolean),
            capturedAt:  new Date().toISOString(),
        };
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    function toBrainstorm(items) {
        if (!items.length) return;
        localStorage.setItem('selectedBrainstormItems', JSON.stringify(items));
        window.location.href = '/Modules/solution-brainstorm/solution-brainstorm.html';
    }

    function toDecisionLog(items) {
        if (!items.length) return;
        localStorage.setItem('pendingDecision', JSON.stringify({
            items,
            name:     items.length === 1 ? items[0].title : '',
            date:     new Date().toISOString().split('T')[0],
            approver: '',
        }));
        window.location.href = '/Modules/decision-log/decision-log.html';
    }

    // ── Text serialisation (for AI API calls) ─────────────────────────────────

    /**
     * Render a SolutionItem as a human-readable plain-text block.
     * Used when sending context to the Brainstorm API.
     */
    function toText(item) {
        const parts = [];
        if (item.widget) parts.push(`[${item.widget}]`);
        if (item.title)  parts.push(item.title);
        if (item.details?.length) {
            parts.push('');
            item.details.forEach(d => parts.push(`${d.label}: ${d.value}`));
        }
        if (item.description) { parts.push(''); parts.push(item.description); }
        if (item.sources?.length) {
            parts.push('');
            parts.push('Sources:');
            item.sources.forEach(s => {
                const meta = [s.value, s.tag].filter(Boolean).join(' · ');
                parts.push(`- ${s.label}${meta ? '  —  ' + meta : ''}`);
            });
        }
        return parts.join('\n');
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _toPlainText(val) {
        if (!val || val instanceof Node) return '';
        const tmp = document.createElement('div');
        tmp.innerHTML = val;
        return (tmp.textContent || tmp.innerText || '').trim();
    }

    return { fromDrillDown, fromArchiveEntry, toBrainstorm, toDecisionLog, toText };
})();
