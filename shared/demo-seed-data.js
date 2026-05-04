'use strict';
/**
 * shared/demo-seed-data.js
 *
 * Sector-specific templates for demo data generation.
 * Pure data — no DB calls, no side effects.
 * All signal/story text uses `app` as placeholder for the appType string.
 */

const SECTORS = {

    'SaaS B2B': (app) => ({
        vision: `Enable B2B teams to get more value from ${app} through intelligent automation and actionable insights — cutting time-to-value by 40%.`,
        objectives: [
            'Reduce average onboarding time from 14 days to 5 days by Q3',
            'Increase 90-day retention from 68% to 82% by end of year',
            'Grow expansion revenue (upsell/cross-sell) to 30% of ARR',
            'Reach NPS of 45+ among power users (daily active)',
        ],
        personas: 'Power User (uses daily, champions internally), Team Lead (manages adoption, reports to VP), Executive Sponsor (budget owner, cares about ROI), New User (just onboarded, overwhelmed)',
        jiraPrefix: 'DEMO',
        epics: [
            { key: 'DEMO-E1', name: 'Core Workflow Engine',       phase: 'Completion', monthStart: -12, monthEnd: -8,  storyCount: 14, doneCount: 14 },
            { key: 'DEMO-E2', name: 'Team Collaboration Suite',   phase: 'Completion', monthStart: -8,  monthEnd: -5,  storyCount: 11, doneCount: 11 },
            { key: 'DEMO-E3', name: 'Mobile Experience v1',       phase: 'Completion', monthStart: -5,  monthEnd: -2,  storyCount: 9,  doneCount: 9  },
            { key: 'DEMO-E4', name: 'Analytics & Reporting Hub',  phase: 'Dev',        monthStart: -2,  monthEnd: 1,   storyCount: 12, doneCount: 6  },
            { key: 'DEMO-E5', name: 'Integration Ecosystem',      phase: 'Refinement', monthStart: 1,   monthEnd: 3,   storyCount: 10, doneCount: 0  },
            { key: 'DEMO-E6', name: 'AI Automation Layer',        phase: 'Discovery',  monthStart: 3,   monthEnd: 5,   storyCount: 8,  doneCount: 0  },
        ],
        strengthSignals: [
            `The workflow automation in ${app} saved our team 6 hours a week — this is a game changer.`,
            `Onboarding new members with ${app} is so much faster now that we have templates. Really impressed.`,
            `NPS survey — Score 9: The search and filtering capabilities are best-in-class for our use case.`,
            `Our team finally has a single source of truth for project tracking. ${app} delivered on that promise.`,
            `The notification system is well-designed. We get alerted on what matters without noise.`,
            `Renewal confirmed — the ROI is clear. Our team's output is up 22% since adopting ${app}.`,
            `Customer interview: The bulk action feature released last sprint is already reducing our admin time significantly.`,
            `NPS Survey — Score 8: Integrations with our existing tools work seamlessly. No friction at all.`,
            `Sales call win: We beat the competitor because of the reporting speed. Customer said it was night and day.`,
            `Support ticket resolved → customer follow-up: "That fix was fast, thank you. This is why we stay with ${app}."`,
        ],
        recurringSignals: [
            `Support ticket: Dashboard loading is noticeably slow when we have more than 500 records. Getting worse.`,
            `User interview: The export to CSV works but the formatting is wrong every time. We have to clean it manually.`,
            `Sales call lost: Prospect said ${app} doesn't have the Salesforce integration depth they need. Deal-breaker.`,
            `Support ticket: Filters reset every time we navigate away. This has been reported before — still happening.`,
            `NPS comment — Score 5: The mobile app feels like an afterthought. Core features are missing.`,
            `User interview: Our team spends 30 minutes a week re-creating the same reports. Templates would help.`,
            `Support ticket: We can't assign tasks to external collaborators without giving them full access. Security concern.`,
            `Sales call: Every prospect asks about Slack integration in the first 5 minutes. We keep losing on this.`,
            `User interview: The permission system is too coarse. We need more granular control per project.`,
            `Analytics: 43% of new users don't complete the second key action within the first session. Activation gap.`,
        ],
        weakSignals: [
            `User interview: This is probably a niche request, but offline access for field teams would be incredible.`,
            `NPS comment: Would love a way to get a weekly digest email summarizing activity across all my projects.`,
            `Support ticket: Is there any way to set up custom approval workflows? Our compliance team is asking.`,
            `Sales call: The prospect mentioned their competitor uses AI to auto-categorize incoming requests. Interesting.`,
            `User interview: Small thing — it would be nice to have keyboard shortcuts for power users like me.`,
            `Community forum: Anyone else wish ${app} had a public API for custom integrations? Workaround is painful.`,
            `NPS comment: Would be great to get AI suggestions on task priority based on deadlines and dependencies.`,
        ],
        alertSignals: [
            `Churn signal: Enterprise account (€180k ARR) flagged dissatisfaction. Main complaint: no SSO support.`,
            `Support escalation: Data export failed silently for a client. They discovered the issue 3 days later. Trust issue.`,
            `Sales call lost: "Your competitor has the same features but their support SLA is 4x better." Second time this month.`,
            `User interview: We're evaluating alternatives. The performance issues are blocking our team's daily work.`,
            `Account health: 3 accounts showed >40% drop in weekly active users. No outreach done yet.`,
        ],
    }),

    'Fintech': (app) => ({
        vision: `Make financial operations effortless for growing businesses — giving finance teams the clarity and control they need through ${app} without the enterprise complexity.`,
        objectives: [
            'Process $500M in monthly transaction volume with <0.01% error rate by Q3',
            'Achieve SOC 2 Type II certification and reduce compliance friction by 60%',
            'Increase finance team activation (3+ features used in week 1) from 45% to 75%',
            'Reduce average reconciliation time from 4 hours to 30 minutes per month',
        ],
        personas: 'CFO (strategic, risk-averse, needs audit trails), Finance Manager (daily user, reconciliation focus), Bookkeeper (data entry heavy, values automation), External Auditor (quarterly, read-only access needs)',
        jiraPrefix: 'FIN',
        epics: [
            { key: 'FIN-E1', name: 'Core Payment Rails',          phase: 'Completion', monthStart: -12, monthEnd: -8,  storyCount: 13, doneCount: 13 },
            { key: 'FIN-E2', name: 'Compliance & Audit Suite',    phase: 'Completion', monthStart: -8,  monthEnd: -5,  storyCount: 10, doneCount: 10 },
            { key: 'FIN-E3', name: 'Multi-currency & FX',         phase: 'Completion', monthStart: -5,  monthEnd: -2,  storyCount: 8,  doneCount: 8  },
            { key: 'FIN-E4', name: 'Smart Reconciliation Engine', phase: 'Dev',        monthStart: -2,  monthEnd: 1,   storyCount: 11, doneCount: 5  },
            { key: 'FIN-E5', name: 'Open Banking API',            phase: 'Refinement', monthStart: 1,   monthEnd: 3,   storyCount: 9,  doneCount: 0  },
            { key: 'FIN-E6', name: 'AI Anomaly Detection',        phase: 'Discovery',  monthStart: 3,   monthEnd: 5,   storyCount: 7,  doneCount: 0  },
        ],
        strengthSignals: [
            `The automated reconciliation in ${app} eliminated our 3-day month-end process. Now takes 4 hours.`,
            `Audit trail feature is exceptional. Our external auditors praised the data integrity and traceability.`,
            `NPS — Score 9: The real-time balance visibility is something we didn't know we needed until we had it.`,
            `CFO interview: Board confidence in our financial data has increased since adopting ${app}. Cleaner reporting.`,
            `The bulk payment feature saved our accounts payable team 8 hours last month. Exactly what we needed.`,
            `NPS — Score 8: The CSV import logic is smart enough to handle our bank's weird format automatically.`,
            `Sales win: Customer switched from a big bank's corporate portal to ${app} specifically for the UX.`,
            `Support feedback: The 2FA implementation is robust but also not annoying. Great balance.`,
        ],
        recurringSignals: [
            `Support ticket: FX rates in ${app} lag by 15 minutes. For large transfers this creates exposure. Critical.`,
            `User interview: We can't split a single invoice across multiple cost centers. Manual workaround is error-prone.`,
            `Sales call: Prospect's bank isn't in the supported list. Third time this week we've hit this blocker.`,
            `Finance Manager interview: The month-end report takes 45 minutes to generate for our volume. Too slow.`,
            `Support ticket: Two-way sync with our ERP drops custom fields. Data loss risk for accounting entries.`,
            `NPS comment — Score 4: We can't set approval thresholds by team. Compliance requires this.`,
            `Sales call lost: Competitor supports SEPA Instant. We're routing large EU payments through SWIFT workaround.`,
            `User interview: Exporting to our accounting software loses the tax categorization. Manual re-entry every time.`,
        ],
        weakSignals: [
            `Finance Manager: Has ${app} considered predictive cash flow forecasting? Would save us a lot of modeling time.`,
            `NPS comment: A mobile app for approving payments on the go would be very convenient for our CFO.`,
            `Support ticket: Is there an API endpoint for triggering payments from our ERP? Our dev team is asking.`,
            `Sales call: Prospect asked about white-labeling ${app} for their own clients. Interesting business model question.`,
            `User interview: Would love automatic categorization of expenses using AI. Our team wastes time on this.`,
        ],
        alertSignals: [
            `Churn risk: Key account ($240k ARR) mentioned they're evaluating Stripe Treasury as an alternative.`,
            `Support escalation: Payment failed silently — customer only noticed 2 days later when the supplier complained.`,
            `Compliance concern: A customer ran a test and found a data residency gap in our EU storage. Escalating.`,
            `User interview: We're pausing expansion because the current performance can't handle our projected volume.`,
        ],
    }),

    'E-commerce': (app) => ({
        vision: `Help e-commerce operators run smarter stores — giving merchandising, marketing, and ops teams the unified intelligence to grow revenue without growing headcount via ${app}.`,
        objectives: [
            'Increase average GMV per merchant from $45k to $75k monthly by Q3',
            'Reduce cart abandonment rate from 71% to 58% through better checkout tooling',
            'Grow merchant retention at 12 months from 61% to 78%',
            'Achieve 50% of merchants using 3+ features (currently 29%)',
        ],
        personas: 'Store Owner (time-poor, growth-focused), Merchandiser (catalog & pricing daily), Marketing Manager (acquisition & retention campaigns), Ops Manager (inventory & fulfillment)',
        jiraPrefix: 'ECM',
        epics: [
            { key: 'ECM-E1', name: 'Catalog & Inventory Core',    phase: 'Completion', monthStart: -12, monthEnd: -8,  storyCount: 12, doneCount: 12 },
            { key: 'ECM-E2', name: 'Checkout Optimization',       phase: 'Completion', monthStart: -8,  monthEnd: -5,  storyCount: 10, doneCount: 10 },
            { key: 'ECM-E3', name: 'Marketing Automation',        phase: 'Completion', monthStart: -5,  monthEnd: -2,  storyCount: 9,  doneCount: 9  },
            { key: 'ECM-E4', name: 'Analytics & Revenue Intel',   phase: 'Dev',        monthStart: -2,  monthEnd: 1,   storyCount: 11, doneCount: 5  },
            { key: 'ECM-E5', name: 'Marketplace Integrations',    phase: 'Refinement', monthStart: 1,   monthEnd: 3,   storyCount: 10, doneCount: 0  },
            { key: 'ECM-E6', name: 'AI Personalization Engine',   phase: 'Discovery',  monthStart: 3,   monthEnd: 5,   storyCount: 8,  doneCount: 0  },
        ],
        strengthSignals: [
            `The bulk pricing editor in ${app} let us reprice our entire catalog in 20 minutes. Previously a full day's work.`,
            `NPS — Score 9: The abandoned cart email sequence is our top revenue recovery tool. Easy to set up.`,
            `Store owner interview: I finally understand which products drive repeat purchase. The cohort analytics are excellent.`,
            `Our Black Friday campaign was the smoothest ever. ${app}'s inventory alerts prevented two stockouts.`,
            `NPS — Score 8: The discount engine flexibility is unmatched. We run complex promo logic without dev help.`,
            `Sales win: Merchant switched from Shopify because of ${app}'s multi-warehouse inventory logic.`,
            `Support feedback: The import/export for product catalogs is fast and handles variant complexity well.`,
        ],
        recurringSignals: [
            `Support ticket: Inventory sync with our 3PL drops quantities randomly. Overselling incidents 3x this month.`,
            `Store owner: The analytics dashboard doesn't show attribution across channels. We're blind on multi-touch.`,
            `NPS comment — Score 5: The mobile ${app} experience for store management is unusable. Not responsive.`,
            `User interview: We can't customize the checkout fields for B2B customers who need VAT numbers.`,
            `Sales call lost: ${app} doesn't integrate with Amazon Seller Central. That's a hard requirement for most prospects.`,
            `Support ticket: The image optimization pipeline is slow. Product pages load in 4.2s. Hurting conversion.`,
            `Merchant interview: Refund workflows are manual. With our volume we need automation here urgently.`,
        ],
        weakSignals: [
            `Store owner: Has ${app} considered a native loyalty points system? We're paying for a third-party plugin.`,
            `NPS comment: Would love AI-generated product descriptions. Writing copy for 2000 SKUs is painful.`,
            `User interview: Is there a way to A/B test product page layouts without leaving ${app}?`,
            `Support ticket: Can we get a supplier portal where vendors update their own stock levels?`,
            `Merchant interview: Predictive reorder suggestions based on sales velocity would save us a lot of headaches.`,
        ],
        alertSignals: [
            `Churn: Large merchant ($180k GMV/month) is moving to a custom build. Said ${app} can't handle their catalog size.`,
            `Support escalation: Payment gateway outage during peak hours — merchants lost estimated $40k in sales.`,
            `User interview: We're seeing 8% higher cart abandonment since the checkout update last month. Investigating.`,
        ],
    }),

    'Healthtech': (app) => ({
        vision: `Reduce clinical administrative burden by 60% — giving healthcare providers more time with patients through intelligent automation in ${app}.`,
        objectives: [
            'Reduce documentation time per patient encounter from 18 min to 7 min by Q3',
            'Achieve HIPAA + SOC 2 Type II compliance across all data flows',
            'Increase provider NPS from 28 to 50 (healthcare baseline is low)',
            'Grow from 12 to 35 active clinic integrations (EHR/scheduling systems)',
        ],
        personas: 'Clinician (time-critical, compliance-aware), Practice Manager (admin, billing focus), IT Admin (security, EHR integration), Patient (indirect, experience matters)',
        jiraPrefix: 'HLT',
        epics: [
            { key: 'HLT-E1', name: 'Clinical Documentation Core',  phase: 'Completion', monthStart: -12, monthEnd: -8,  storyCount: 13, doneCount: 13 },
            { key: 'HLT-E2', name: 'EHR Integration Layer',        phase: 'Completion', monthStart: -8,  monthEnd: -5,  storyCount: 10, doneCount: 10 },
            { key: 'HLT-E3', name: 'Billing & Claims Automation',  phase: 'Completion', monthStart: -5,  monthEnd: -2,  storyCount: 8,  doneCount: 8  },
            { key: 'HLT-E4', name: 'AI Clinical Notes Assistant',  phase: 'Dev',        monthStart: -2,  monthEnd: 1,   storyCount: 12, doneCount: 5  },
            { key: 'HLT-E5', name: 'Patient Engagement Portal',    phase: 'Refinement', monthStart: 1,   monthEnd: 3,   storyCount: 9,  doneCount: 0  },
            { key: 'HLT-E6', name: 'Predictive Care Analytics',    phase: 'Discovery',  monthStart: 3,   monthEnd: 5,   storyCount: 7,  doneCount: 0  },
        ],
        strengthSignals: [
            `The template library in ${app} reduced my documentation time from 20 to 8 minutes per patient. Life-changing.`,
            `NPS — Score 9: The HIPAA audit trail gives me peace of mind. Every access is logged and explainable.`,
            `Practice manager interview: Claims submission errors dropped by 70% since we started using ${app}'s validation.`,
            `Our Epic EHR integration works flawlessly. Data flows both ways without manual re-entry. Finally.`,
            `Provider survey: ${app} is the first clinical tool our doctors actually like using. Adoption is 94%.`,
            `NPS — Score 8: The mobile documentation during rounds is a genuine workflow improvement.`,
        ],
        recurringSignals: [
            `Support ticket: ${app} times out during peak morning hours (8-10am). Clinicians can't document in real-time.`,
            `Clinician interview: The voice-to-text transcription misses medical terminology too often. Trust is low.`,
            `Practice manager: We can't customize billing codes per payer. Manual override every time. Hours per week wasted.`,
            `Support ticket: Patient consent forms can't be collected digitally in ${app}. Still printing paper.`,
            `IT admin: The Cerner integration has been "coming soon" for 6 months. Half our network runs Cerner.`,
            `NPS comment — Score 4: The scheduling view doesn't integrate with our calendar. Double-booking risk.`,
            `Clinician interview: Prescription history isn't surfaced during encounters. I have to switch systems to check.`,
        ],
        weakSignals: [
            `Clinician: Would ${app} ever support dictation that auto-generates structured SOAP notes?`,
            `Practice manager: A patient-facing portal for pre-visit intake forms would eliminate our paper process.`,
            `NPS comment: Remote patient monitoring data integration would make ${app} a complete clinical platform.`,
            `IT admin: Is there a FHIR R4 API? Our new telehealth vendor requires it for integration.`,
        ],
        alertSignals: [
            `Churn risk: Hospital group (8 clinics) is evaluating Nuance DAX. AI dictation is the key differentiator.`,
            `Compliance escalation: A PHI data access log showed unauthorized query patterns. Investigating immediately.`,
            `Clinician interview: Two providers in our group went back to paper because ${app} is too slow during rounds.`,
        ],
    }),

    'EdTech': (app) => ({
        vision: `Personalize learning at scale — helping educational institutions deliver measurable outcomes for every student through ${app}'s adaptive intelligence.`,
        objectives: [
            'Improve average student course completion rate from 54% to 75% by end of year',
            'Reduce instructor administrative workload by 40% through automation',
            'Grow institutional client base from 18 to 45 by Q3',
            'Achieve learning outcome improvement (pre/post assessment) of 35%+ across cohorts',
        ],
        personas: 'Instructor (content creator, assessment designer), Student (learner, mobile-first), Administrator (LMS config, reporting), L&D Manager (corporate training, ROI focus)',
        jiraPrefix: 'EDT',
        epics: [
            { key: 'EDT-E1', name: 'Core Learning Management',     phase: 'Completion', monthStart: -12, monthEnd: -8,  storyCount: 12, doneCount: 12 },
            { key: 'EDT-E2', name: 'Assessment & Grading Engine',  phase: 'Completion', monthStart: -8,  monthEnd: -5,  storyCount: 10, doneCount: 10 },
            { key: 'EDT-E3', name: 'Mobile Learning App',          phase: 'Completion', monthStart: -5,  monthEnd: -2,  storyCount: 9,  doneCount: 9  },
            { key: 'EDT-E4', name: 'Analytics & Outcomes Dashboard',phase: 'Dev',       monthStart: -2,  monthEnd: 1,   storyCount: 11, doneCount: 5  },
            { key: 'EDT-E5', name: 'Content Authoring Suite',      phase: 'Refinement', monthStart: 1,   monthEnd: 3,   storyCount: 9,  doneCount: 0  },
            { key: 'EDT-E6', name: 'AI Tutoring & Personalization', phase: 'Discovery', monthStart: 3,   monthEnd: 5,   storyCount: 8,  doneCount: 0  },
        ],
        strengthSignals: [
            `The quiz builder in ${app} cut my assessment creation time from 2 hours to 20 minutes. Excellent.`,
            `NPS — Score 9: Students actually complete courses now. The progress tracking gamification works.`,
            `Administrator interview: Onboarding new instructors is self-serve. We no longer need IT involved.`,
            `Our cohort completion rate jumped from 48% to 71% in the first semester using ${app}. Real impact.`,
            `NPS — Score 8: The mobile app works offline. Our students in low-connectivity areas can finally participate.`,
            `L&D manager: The ROI reporting for our board is now automatic. Previously took 2 days to compile manually.`,
        ],
        recurringSignals: [
            `Instructor interview: I can't embed interactive simulations in ${app} content. Linking out breaks the flow.`,
            `Student feedback: Video streaming buffers constantly during live sessions. Losing engagement.`,
            `NPS comment — Score 5: The SCORM import breaks formatting on complex courses. Hours of reformatting.`,
            `Administrator: We can't white-label ${app} for our institutional brand. Students are confused.`,
            `Sales call lost: Prospect requires LTI 1.3 integration with their Moodle instance. Not supported yet.`,
            `Instructor interview: Grading 200 open-ended submissions takes me a full day. AI assistance would help.`,
            `L&D manager: The cohort analytics don't show drop-off points within lessons. I can't identify where students disengage.`,
        ],
        weakSignals: [
            `Instructor: Would love peer review features where students assess each other's work with rubrics.`,
            `NPS comment: AI-generated quiz questions from my uploaded content would save enormous time.`,
            `Administrator: Is there a way to set up automated certificate generation upon course completion?`,
            `Student feedback: A study group feature within ${app} would reduce the need for external tools.`,
        ],
        alertSignals: [
            `Churn risk: University client (800 students) is evaluating Canvas. "We need LTI support. It's a hard requirement."`,
            `Support escalation: Video hosting outage during final exams. Multiple institutions affected simultaneously.`,
            `Instructor: Three colleagues in my department went back to Google Classroom because ${app} is too complex.`,
        ],
    }),
};

module.exports = function getSectorData(sector, appType) {
    const fn = SECTORS[sector] || SECTORS['SaaS B2B'];
    return fn(appType || 'the app');
};
