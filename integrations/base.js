/**
 * BaseIntegration — abstract interface for PM tool connectors
 */
class BaseIntegration {
    constructor(config) {
        if (new.target === BaseIntegration) {
            throw new Error('BaseIntegration is abstract — extend it instead.');
        }
        this.config = config;
    }

    /**
     * Verify credentials and connectivity.
     * @returns {Promise<{ success: boolean, message: string }>}
     */
    async testConnection() {
        throw new Error('testConnection() must be implemented');
    }

    /**
     * Create a ticket/issue in the remote tool.
     * @param {{ title: string, description: string, riceScore: number, labels: string[] }} ticket
     * @returns {Promise<{ ticketKey: string, ticketUrl: string }>}
     */
    async createTicket({ title, description, riceScore, labels }) {
        throw new Error('createTicket() must be implemented');
    }

    /**
     * List available projects in the remote tool.
     * @returns {Promise<Array<{ id: string, key: string, name: string }>>}
     */
    async getProjects() {
        throw new Error('getProjects() must be implemented');
    }

    /**
     * Pull signals from the remote tool (blocked / high-priority tickets, etc.)
     * and return them in hub-compatible format.
     * @returns {Promise<Array<{ body: string, sourceType: string, person: string, date: string }>>}
     */
    async fetchSignals() {
        throw new Error('fetchSignals() must be implemented');
    }
}

module.exports = BaseIntegration;
