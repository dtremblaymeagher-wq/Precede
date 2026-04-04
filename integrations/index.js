const JiraIntegration = require('./jira');

/**
 * Factory — return the right connector based on config.type.
 *
 * @param {{ type: string, [key: string]: any }} config
 * @returns {BaseIntegration}
 */
function getIntegration(config) {
    if (!config || !config.type) {
        throw new Error('Integration config must include a "type" field');
    }

    switch (config.type.toLowerCase()) {
        case 'jira':
            return new JiraIntegration(config);

        case 'linear':
        case 'asana':
        case 'monday':
        case 'azure-devops':
        case 'github':
            throw new Error(`${config.type} integration coming soon`);

        default:
            throw new Error(`Unknown integration type: "${config.type}"`);
    }
}

module.exports = { getIntegration };
