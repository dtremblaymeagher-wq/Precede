// shared/client-constants.js
// Browser-side single source of truth for all magic strings.
// Loaded automatically by auth.js — no extra <script> tag needed on pages.
//
// Usage anywhere after auth.js loads:
//   localStorage.getItem(PRECEDE.INSTANCE_KEY)
//   localStorage.setItem(PRECEDE.SOLUTION_MODE_KEY, 'true')

/* eslint-disable no-unused-vars */
window.PRECEDE = {

    // ── localStorage keys ─────────────────────────────────────────────────
    INSTANCE_KEY:            'precede_active_instance_id',
    PLAN_KEY:                'precede_plan',
    VISIT_KEY:               'precede_last_seen_analysis',
    SOLUTION_MODE_KEY:       'solutionMode',
    PENDING_STORY_KEY:       'pendingStoryIdea',
    PENDING_SIGNAL_IDS_KEY:  'pendingStorySignalIds',
    PENDING_DECISION_KEY:    'pendingDecision',
    BRAINSTORM_ITEMS_KEY:    'selectedBrainstormItems',
    BRAINSTORM_CHAT_KEY:     'brainstormChatHistory',
    BRAINSTORM_SESSIONS_KEY: 'brainstormSessions',
    VISION_RETURN_KEY:       'visionBoardReturnToSettings',
    VISION_CURRENT_KEY:      'visionBoardCurrentVision',
    EXEC_FIRST_VIEW_KEY:     'execDashboardFirstViewAt',

    // ── Clerk ─────────────────────────────────────────────────────────────
    // Server middleware (server.js:47-58) swaps this test key for the
    // CLERK_PUBLISHABLE_KEY env var on every HTML response before it's
    // served. Every HTML file must use this exact string in its
    // data-clerk-publishable-key attribute for the swap to work.
    // NEVER change this value without also updating server.js:47.
    CLERK_TEST_KEY: 'pk_test_dmFzdC1wZWdhc3VzLTQzLmNsZXJrLmFjY291bnRzLmRldiQ',

};
