const BaseIntegration = require('./base');

/**
 * JiraIntegration — connector for Atlassian Jira Cloud
 *
 * Config: { baseUrl, apiKey, email, projectKey }
 * Auth:   HTTP Basic — base64(email:apiKey)
 */
class JiraIntegration extends BaseIntegration {
    constructor(config) {
        super(config);
        const { baseUrl, apiKey, email } = config;
        if (!baseUrl || !apiKey || !email) {
            throw new Error('Jira config requires baseUrl, email, and apiKey');
        }
        // Normalise trailing slash and strip any accidental whitespace
        this.baseUrl    = baseUrl.trim().replace(/\/$/, '');
        this.authHeader = 'Basic ' + Buffer.from(`${email.trim()}:${apiKey.trim()}`).toString('base64');
    }

    // ── Shared fetch helper ──────────────────────────────────────────────────

    async _request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        const options = {
            method,
            headers: {
                'Authorization': this.authHeader,
                'Accept':        'application/json',
                'Content-Type':  'application/json',
            },
        };
        if (body !== undefined) {
            options.body = JSON.stringify(body);
        }

        const res = await fetch(url, options);

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Jira API ${method} ${path} → ${res.status}: ${text}`);
        }

        // 204 No Content
        if (res.status === 204) return null;
        return res.json();
    }

    // ── Priority mapping ─────────────────────────────────────────────────────

    _priority(riceScore) {
        if (riceScore > 50) return { name: 'High' };
        if (riceScore > 20) return { name: 'Medium' };
        return { name: 'Low' };
    }

    // ── Jira document format helper ──────────────────────────────────────────

    _toDoc(text) {
        // Split on double newlines for paragraphs, single newlines become hardBreaks
        const paragraphs = text.split(/\n{2,}/);
        return {
            type: 'doc',
            version: 1,
            content: paragraphs.map(para => ({
                type: 'paragraph',
                content: para.split('\n').flatMap((line, i, arr) => {
                    const node = { type: 'text', text: line };
                    return i < arr.length - 1
                        ? [node, { type: 'hardBreak' }]
                        : [node];
                }),
            })),
        };
    }

    // ── Search helpers (new cursor-based endpoint) ───────────────────────────
    // IMPORTANT: uses encodeURIComponent so spaces become %20, not +.
    // Jira's REST API treats + as a literal character in JQL, causing silent
    // empty results. URLSearchParams must NOT be used for Jira query strings.

    _qs(params) {
        return Object.entries(params)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');
    }

    // Single page — use when results fit in one call (e.g. issueKey in (...)).
    async search(jql, fields, maxResults = 100) {
        const data = await this._request('GET', `/rest/api/3/search/jql?${this._qs({
            jql, maxResults: String(maxResults), fields: Array.isArray(fields) ? fields.join(',') : fields,
        })}`);
        return data.issues || [];
    }

    // Paginated — fetches ALL matching issues across multiple pages.
    // Verifies auth on first request: Jira's search endpoint returns 200+empty
    // for invalid tokens instead of 401, so we catch it explicitly.
    async searchAll(jql, fields, pageSize = 100) {
        const auth = await this.testConnection();
        if (!auth.success) throw new Error(`Jira authentication failed: ${auth.message}`);

        const all = [];
        let nextPageToken;
        do {
            const params = { jql, maxResults: String(pageSize), fields: Array.isArray(fields) ? fields.join(',') : fields };
            if (nextPageToken) params.nextPageToken = nextPageToken;
            const data = await this._request('GET', `/rest/api/3/search/jql?${this._qs(params)}`);
            all.push(...(data.issues || []));
            nextPageToken = data.isLast ? null : data.nextPageToken;
        } while (nextPageToken);
        return all;
    }

    // ── Public methods ───────────────────────────────────────────────────────

    async testConnection() {
        try {
            const data = await this._request('GET', '/rest/api/3/myself');
            return { success: true, message: `Connected as ${data.displayName} (${data.emailAddress})` };
        } catch (err) {
            return { success: false, message: err.message };
        }
    }

    async createTicket({ title, description, riceScore = 0, labels = [], issueType = 'Story' }) {
        const { projectKey } = this.config;
        if (!projectKey) throw new Error('projectKey is required to create a ticket');

        const body = {
            fields: {
                project:     { key: projectKey },
                summary:     title,
                description: this._toDoc(description),
                issuetype:   { name: issueType },
                priority:    this._priority(riceScore),
                labels:      labels.filter(Boolean),
            },
        };

        const data = await this._request('POST', '/rest/api/3/issue', body);
        return {
            ticketKey: data.key,
            ticketUrl: `${this.baseUrl}/browse/${data.key}`,
        };
    }

    async getProjects() {
        const data = await this._request('GET', '/rest/api/3/project');
        return (Array.isArray(data) ? data : data.values || []).map(p => ({
            id:   p.id,
            key:  p.key,
            name: p.name,
        }));
    }

    // Returns sprint completion stats from the Jira Sprint Report.
    // Uses the greenhopper endpoint which captures the sprint state at close time —
    // the only source that accurately distinguishes added, removed, and rollover stories.
    // boardId is required (from integration config).
    async getSprintIssueStats(sprintId, boardId) {
        const data = await this._request('GET',
            `/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${boardId}&sprintId=${sprintId}`
        );
        const c = data?.contents ?? {};
        // Field names vary across Jira Cloud versions
        const toCount = val => Array.isArray(val) ? val.length : (val && typeof val === 'object' ? Object.keys(val).length : 0);
        const completed = toCount(c.completedIssues);
        const rollover  = toCount(c.incompletedIssues ?? c.issuesNotCompletedInCurrentSprint);
        const removed   = toCount(c.puntedIssues ?? c.issueKeysRemovedFromSprint);
        const added     = toCount(c.issueKeysAddedDuringSprint);
        return {
            completed,
            total:   completed + rollover + removed,
            added,
            removed,
            rollover,
        };
    }

    async fetchSignals() {
        // Pull comments from issues updated in the last 30 days
        const projectClause = this.config.projectKey ? `project = "${this.config.projectKey}" AND ` : '';
        const data = await this._request('POST', '/rest/api/3/search/jql', {
            jql:        `${projectClause}comment is not EMPTY AND updated >= "-30d" ORDER BY updated DESC`,
            maxResults: 50,
            fields:     ['summary', 'comment'],
        });

        const signals = [];
        for (const issue of (data.issues || [])) {
            const f = issue.fields;
            for (const c of (f.comment?.comments || [])) {
                const body = c.body ? this._docToText(c.body) : '';
                if (!body.trim()) continue;
                signals.push({
                    body:       `[${issue.key}] ${f.summary}\n${body}`.trim(),
                    sourceType: 'Jira Comment',
                    person:     c.author?.displayName || 'Jira User',
                    date:       (c.created || new Date().toISOString()).slice(0, 10),
                });
            }
        }
        return signals;
    }

    // ── Internal: flatten Jira doc to plain text ─────────────────────────────

    _docToText(doc) {
        if (!doc || !doc.content) return '';
        return doc.content.flatMap(block => {
            if (!block.content) return [];
            return block.content.map(node => node.text || '').join('');
        }).join('\n');
    }
}

module.exports = JiraIntegration;
