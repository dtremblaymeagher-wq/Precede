# Precede

B2B SaaS platform that transforms implicit product signals into structured, 
actionable intelligence. Built solo from idea to production in 3 months.

## What It Does

Product managers generate real signal every day — in standups, customer calls, 
Slack threads, and backlog decisions. Precede captures that signal, structures 
it using AI, and makes it defensible and traceable.

Core features:
- Signal dashboard with AI analysis (two-stage: factual extraction + strategic synthesis)
- Executive dashboard with Chief of Staff persona, cached per sprint
- Bidirectional Jira integration with AI-generated story linking
- Response Lead Time tracking (signal to story)
- Portfolio Risk Monitor
- AI Brainstorming and Solution Mode
- Stakeholder Radar
- Learning vault with self-improvement loop

## Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** HTML, CSS, JavaScript, Tailwind
- **Database:** Supabase (PostgreSQL) with RLS per instance
- **Auth:** Clerk
- **AI:** Claude API (Anthropic) — multi-role LLM orchestration, 
  stateless calls, all usage logged via claudeCall() wrapper
- **Deployment:** Railway
- **Integrations:** Jira (bidirectional via webhooks)
- **Testing:** Playwright (e2e)

## Architecture Decisions

- All Supabase queries filter by `instance_id` — multi-tenant isolation
- Claude API calls are stateless — no context bleeding between instances
- LLM routing by task complexity (faster model for simple extraction, 
  stronger model for strategic synthesis)
- Eval framework to measure signal quality vs. noise

## Status

MVP shipped with external pilots. Strategic decision made not to scale — 
market window for PM-specific intelligence tools narrowing faster than 
the growth timeline justified.

## Setup

```bash
npm install
cp .env.example .env
# Add your keys: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY, CLERK keys, 
# JIRA credentials
node server.js
```

## About

Built by David Tremblay Meagher — Senior Product Manager and AI builder.
