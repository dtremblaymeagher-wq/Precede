/**
 * StoryImporterBase — abstract interface for story import adapters.
 *
 * Subclasses must implement:
 *   getSourceName()    → string            e.g. 'jira', 'linear'
 *   fetchInitial()     → Promise<raw[]>    all non-completed stories (one-time)
 *   fetchIncremental() → Promise<raw[]>    stories changed in last 24h
 *   normalize(raw)     → NormalizedStory   maps source fields to internal schema
 *
 * NormalizedStory shape:
 * {
 *   externalId:     string,   // source ticket key  e.g. 'PROJ-123'
 *   source:         string,   // e.g. 'jira'
 *   projectKey:     string,   // e.g. 'PROJ'
 *   issueType:      string,   // e.g. 'Story', 'Bug'
 *   priority:       string|null,
 *   title:          string,
 *   content:        string,   // plain text (used for display + Jira push)
 *   contentText:    string,   // same — explicit copy for AI/export
 *   status:         string,
 *   sprintName:     string|null,
 *   labels:         string[],
 *   importedEffort: number|null,  // story points — preserved, not recalculated
 * }
 */
class StoryImporterBase {
    constructor(config) {
        this.config = config;
    }

    getSourceName()     { throw new Error(`${this.constructor.name} must implement getSourceName()`); }
    async fetchInitial()      { throw new Error(`${this.constructor.name} must implement fetchInitial()`); }
    async fetchIncremental()  { throw new Error(`${this.constructor.name} must implement fetchIncremental()`); }
    normalize(raw)            { throw new Error(`${this.constructor.name} must implement normalize()`); }
}

module.exports = StoryImporterBase;
