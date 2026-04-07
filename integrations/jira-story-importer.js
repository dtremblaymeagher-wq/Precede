const StoryImporterBase = require('./story-importer-base');
const JiraIntegration   = require('./jira');

/**
 * JiraStoryImporter — imports Jira issues into the local backlog schema.
 *
 * Fetch strategy:  GET /rest/api/3/search/jql (cursor-based, via JiraIntegration.searchAll)
 * Initial import:  status not in (Done)  (all open work)
 * Story points:    customfield_10016 (Jira Cloud standard)
 * ADF body:        converted via JiraIntegration._docToText()
 */
class JiraStoryImporter extends StoryImporterBase {
    constructor(config) {
        super(config);
        this.jira = new JiraIntegration(config);
    }

    getSourceName() { return 'jira'; }

    async _fetch(jql) {
        return this.jira.searchAll(jql, [
            'summary', 'description', 'status', 'labels', 'issuetype', 'priority',
            'created', 'updated',
            'customfield_10016', // story points (Jira Cloud standard)
            'customfield_10020', // sprint (Jira Cloud standard)
            'customfield_10014', // epic link (Jira Cloud classic)
            'customfield_10008', // epic name (Jira Cloud classic)
            'parent',            // epic link (next-gen / team-managed projects)
            'comment',
        ]);
    }

    async fetchInitial() {
        const prefix = this.config.projectKey ? `project = "${this.config.projectKey}" AND ` : '';
        return this._fetch(`${prefix}status not in (Done) ORDER BY created ASC`);
    }

    async fetchIncremental(since = '-24h') {
        const prefix = this.config.projectKey ? `project = "${this.config.projectKey}" AND ` : '';
        return this._fetch(`${prefix}updated >= "${since}" ORDER BY updated DESC`);
    }

    normalize(issue, jiraRank = 0) {
        const f           = issue.fields;
        const description = f.description ? this.jira._docToText(f.description) : '';
        const storyPoints = f.customfield_10016 ?? f.customfield_10028 ?? f.story_points ?? null;

        // Sprint: customfield_10020 can be an array of sprint objects or legacy strings
        let sprintName = null, sprintId = null, sprintState = null;
        const sprintField = f.customfield_10020;
        if (Array.isArray(sprintField) && sprintField.length > 0) {
            const last = sprintField[sprintField.length - 1];
            if (typeof last === 'object') {
                sprintName  = last?.name  || null;
                sprintId    = last?.id    || null;
                sprintState = last?.state || null; // 'active' | 'future' | 'closed'
            } else {
                const s = String(last);
                sprintName  = s.match(/name=([^,\]]+)/)?.[1]?.trim()  || null;
                sprintState = s.match(/state=([^,\]]+)/)?.[1]?.trim() || null;
            }
        } else if (typeof sprintField === 'string') {
            sprintName  = sprintField.match(/name=([^,\]]+)/)?.[1]?.trim()  || null;
            sprintState = sprintField.match(/state=([^,\]]+)/)?.[1]?.trim() || null;
        }

        // Epic: classic boards use customfield_10014 (key) + customfield_10008 (name)
        //       next-gen boards use parent.key + parent.fields.summary
        const epicKey  = f.customfield_10014
            ?? (f.parent?.fields?.issuetype?.name === 'Epic' ? f.parent.key : null)
            ?? null;
        const epicName = f.customfield_10008
            ?? (f.parent?.fields?.issuetype?.name === 'Epic' ? f.parent.fields?.summary : null)
            ?? null;

        return {
            externalId:     issue.key,
            source:         'jira',
            projectKey:     issue.key.split('-')[0],
            issueType:      f.issuetype?.name  || 'Story',
            priority:       f.priority?.name   || null,
            title:          f.summary          || '',
            content:        description,
            contentText:    description,
            status:            f.status?.name              || 'To Do',
            statusCategoryKey: f.status?.statusCategory?.key ?? null,
            sprintName, sprintId, sprintState, jiraRank,
            labels:         Array.isArray(f.labels) ? f.labels : [],
            importedEffort: storyPoints !== null ? Number(storyPoints) : null,
            epicKey, epicName,
            comments: (f.comment?.comments || []).map(c => ({
                author:    c.author?.displayName || 'Jira User',
                body:      c.body ? this.jira._docToText(c.body) : '',
                createdAt: c.created || new Date().toISOString(),
                source:    'jira',
            })),
        };
    }
}

module.exports = JiraStoryImporter;
