/**
 * shared/drilldown-panel.js — Drill-down Side Panel
 *
 * Injects the panel DOM once, then opens/closes via DrillDown.open() / DrillDown.close().
 *
 * ── API ───────────────────────────────────────────────────────────────────
 *
 * DrillDown.open({
 *   label:       string,           // small-caps tag above the title (e.g. "Widget 1A · OKR Alignment")
 *   title:       string,           // main heading
 *   description: string | Node,    // HTML string or DOM node — rich explanation
 *   details: [                     // optional key/value blocks below description
 *     { label: string, value: string }
 *   ],
 *   sources: [                     // reference items in the bottom section
 *     { label: string, value?: string, tag?: string, tagVariant?: 'success'|'warning'|'danger'|'info'|'neutral' }
 *   ]
 * })
 *
 * DrillDown.close()
 *
 * ── Events ────────────────────────────────────────────────────────────────
 * window dispatchEvent(new CustomEvent('drilldown:open', { detail: payload }))
 * window dispatchEvent(new CustomEvent('drilldown:close'))
 */

const DrillDown = (() => {
    let _panel          = null;
    let _backdrop       = null;
    let _keyHandler     = null;
    let _currentPayload = null;   // retained for solution-mode Send-to buttons


    function _inject() {
        if (document.getElementById('dd-panel')) return;

        const backdrop = document.createElement('div');
        backdrop.id = 'dd-backdrop';
        backdrop.addEventListener('click', close);
        document.body.appendChild(backdrop);

        const panel = document.createElement('div');
        panel.id = 'dd-panel';
        panel.setAttribute('role', 'complementary');
        panel.setAttribute('aria-label', 'Details panel');
        panel.innerHTML = `
            <div id="dd-header">
                <div id="dd-header-top">
                    <div id="dd-label"></div>
                    <button id="dd-close" title="Close (Esc)" aria-label="Close panel">✕</button>
                </div>
                <h2 id="dd-title"></h2>
            </div>

            <div id="dd-body">
                <div id="dd-description"></div>
                <div id="dd-details"></div>
                <div id="dd-related" style="display:none;"></div>
                <div id="dd-sources">
                    <div id="dd-sources-label">Sources &amp; Related</div>
                    <div id="dd-sources-list"></div>
                    <div id="dd-sources-empty" style="display:none;">No references available.</div>
                </div>
                <div style="height:24px;"></div>
            </div>

            <div id="dd-footer">
                <span class="dd-footer-label">Send to</span>
                <button class="dd-footer-btn dd-footer-btn--brainstorm" id="dd-btn-brainstorm">Brainstorm</button>
                <button class="dd-footer-btn dd-footer-btn--decision"   id="dd-btn-decision">Decision Log</button>
                <button class="dd-footer-btn dd-footer-btn--groom"      id="dd-btn-groom">Groom Story</button>
                <button class="dd-footer-btn dd-footer-btn--feedback"   id="dd-btn-feedback">Improve AI response</button>
            </div>
            <div id="dd-feedback-form" style="display:none;">
                <textarea id="dd-feedback-textarea" placeholder="What was missing, wrong, or could be better?" rows="3"></textarea>
                <div id="dd-feedback-actions">
                    <button id="dd-feedback-submit">Send feedback</button>
                    <button id="dd-feedback-cancel">Cancel</button>
                    <span id="dd-feedback-saved" style="display:none;">✓ Saved</span>
                </div>
            </div>`;

        panel.querySelector('#dd-close').addEventListener('click', close);

        panel.querySelector('#dd-btn-brainstorm').addEventListener('click', () => {
            if (window.SolutionTransfer && _currentPayload)
                SolutionTransfer.toBrainstorm([SolutionTransfer.fromDrillDown(_currentPayload)]);
        });
        panel.querySelector('#dd-btn-decision').addEventListener('click', () => {
            if (window.SolutionTransfer && _currentPayload)
                SolutionTransfer.toDecisionLog([SolutionTransfer.fromDrillDown(_currentPayload)]);
        });
        panel.querySelector('#dd-btn-groom').addEventListener('click', () => {
            if (window.SolutionTransfer && _currentPayload)
                SolutionTransfer.toGrooming([SolutionTransfer.fromDrillDown(_currentPayload)]);
        });

        const feedbackForm   = panel.querySelector('#dd-feedback-form');
        const feedbackBtn    = panel.querySelector('#dd-btn-feedback');
        const feedbackTA     = panel.querySelector('#dd-feedback-textarea');
        const feedbackSubmit = panel.querySelector('#dd-feedback-submit');
        const feedbackCancel = panel.querySelector('#dd-feedback-cancel');
        const feedbackSaved  = panel.querySelector('#dd-feedback-saved');

        feedbackBtn.addEventListener('click', () => {
            const open = feedbackForm.style.display === 'none';
            feedbackForm.style.display = open ? '' : 'none';
            if (open) feedbackTA.focus();
        });

        feedbackCancel.addEventListener('click', () => {
            feedbackForm.style.display = 'none';
            feedbackTA.value = '';
        });

        feedbackSubmit.addEventListener('click', async () => {
            const comment = feedbackTA.value.trim();
            if (!comment) return;
            feedbackSubmit.disabled = true;
            try {
                const item = _currentPayload ? (window.SolutionTransfer ? SolutionTransfer.fromDrillDown(_currentPayload) : null) : null;
                const context = {
                    selectedItems: item ? [item.title || ''] : [],
                    aiSnippet:     item ? (item.description || '').slice(0, 300) : '',
                };
                await Auth.fetch('/api/learning/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ comment, context }),
                });
                feedbackForm.style.display = 'none';
                feedbackTA.value = '';
                feedbackSaved.style.display = '';
                feedbackBtn.textContent = '✓ Feedback sent';
                setTimeout(() => { feedbackSaved.style.display = 'none'; }, 3000);
            } catch (e) {
                console.error('Feedback error', e);
            } finally {
                feedbackSubmit.disabled = false;
            }
        });

        document.body.appendChild(panel);

        _panel    = panel;
        _backdrop = backdrop;
    }

    function open(payload = {}) {
        _currentPayload = payload;
        _inject();

        const { label = '', title = '', description = '', details = [], sources = [], related = [] } = payload;

        // Reset feedback form on each open
        const ffBtn = document.getElementById('dd-btn-feedback');
        const ffForm = document.getElementById('dd-feedback-form');
        const ffTA = document.getElementById('dd-feedback-textarea');
        if (ffBtn)  { ffBtn.textContent = 'Improve AI response'; }
        if (ffForm) { ffForm.style.display = 'none'; }
        if (ffTA)   { ffTA.value = ''; }

        // Header
        document.getElementById('dd-label').textContent = label;
        document.getElementById('dd-title').textContent = title;

        // Description
        const descEl = document.getElementById('dd-description');
        if (description instanceof Node) {
            descEl.innerHTML = '';
            descEl.appendChild(description);
        } else {
            descEl.innerHTML = description;
        }

        // Detail blocks
        const detailsEl = document.getElementById('dd-details');
        if (details.length) {
            detailsEl.innerHTML = details.map(d => `
                <div class="dd-detail-block">
                    <div class="dd-detail-block-label">${Auth.esc(d.label)}</div>
                    <div class="dd-detail-block-value">${d.value instanceof Node ? '' : Auth.esc(d.value)}</div>
                </div>`).join('');
            // For Node values, append after
            details.forEach((d, i) => {
                if (d.value instanceof Node) {
                    detailsEl.querySelectorAll('.dd-detail-block-value')[i]?.appendChild(d.value);
                }
            });
        } else {
            detailsEl.innerHTML = '';
        }

        // Sources
        const listEl  = document.getElementById('dd-sources-list');
        const emptyEl = document.getElementById('dd-sources-empty');
        if (sources.length) {
            listEl.innerHTML = sources.map(s => {
                const tagVariant = s.tagVariant ? ` ${s.tagVariant}` : '';
                const hasBody    = s.body != null && s.body !== '';
                return `
                <div class="dd-source-item${hasBody ? ' dd-source-expandable' : ''}">
                    <div class="dd-source-row">
                        <span class="dd-source-label">${Auth.esc(s.label)}</span>
                        <span style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                            ${s.value != null ? `<span class="dd-source-value">${Auth.esc(s.value)}</span>` : ''}
                            ${s.tag   != null ? `<span class="dd-source-tag${tagVariant}">${Auth.esc(s.tag)}</span>` : ''}
                            ${hasBody         ? `<span class="dd-source-chevron" aria-hidden="true">›</span>` : ''}
                        </span>
                    </div>
                    ${hasBody ? `<div class="dd-source-body">${Auth.esc(s.body)}</div>` : ''}
                </div>`;
            }).join('');

            // Expand / collapse on click — stop propagation so backdrop doesn't close
            listEl.querySelectorAll('.dd-source-expandable').forEach(el => {
                el.addEventListener('click', e => {
                    e.stopPropagation();
                    el.classList.toggle('dd-source-expanded');
                });
            });

            listEl.style.display  = 'flex';
            emptyEl.style.display = 'none';
        } else {
            listEl.style.display  = 'none';
            emptyEl.style.display = 'block';
        }

        // Related navigation
        const relatedEl = document.getElementById('dd-related');
        if (related.length) {
            relatedEl.innerHTML = `
                <div class="dd-related-label">Jump to</div>
                <div class="dd-related-list">
                    ${related.map(r => `
                    <button class="dd-related-btn" onclick="${Auth.esc(r.onclick)}">
                        ${Auth.esc(r.label)} ↗
                    </button>`).join('')}
                </div>`;
            relatedEl.style.display = 'block';
        } else {
            relatedEl.innerHTML = '';
            relatedEl.style.display = 'none';
        }

        // Animate in
        requestAnimationFrame(() => {
            _backdrop.classList.add('dd-visible');
            _panel.classList.add('dd-visible');
        });

        // Esc to close
        _keyHandler = e => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', _keyHandler);

        window.dispatchEvent(new CustomEvent('drilldown:open', { detail: payload }));
    }

    function close() {
        if (!_panel) return;
        _backdrop.classList.remove('dd-visible');
        _panel.classList.remove('dd-visible');
        if (_keyHandler) {
            document.removeEventListener('keydown', _keyHandler);
            _keyHandler = null;
        }
        window.dispatchEvent(new CustomEvent('drilldown:close'));
    }

    return { open, close };
})();
