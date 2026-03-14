# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the local server (required to use any module)
node server.js          # Runs on http://localhost:3001

# Build Tailwind CSS (run after editing shared/style.css)
npm run build:css       # Reads shared/style.css → writes shared/style.generated.css
```

There is no test suite and no linter configured.

## Architecture

This is a PM AI Toolkit — a collection of AI-powered tools for product managers. The stack is vanilla HTML/CSS/JS on the frontend with an Express.js backend acting as a secure Claude API proxy.

### Request flow

Browser → `server.js` (port 3001) → Anthropic Claude API

`server.js` serves all static files and exposes `/api/*` endpoints. Modules never call the Claude API directly from the browser; all AI calls go through the backend so the API key (`ANTHROPIC_API_KEY` from `.env`) stays server-side.

### Module structure

Each module lives in `Modules/<module-name>/` and is self-contained:
- An `.html` file (UI)
- A `.js` file (frontend logic, calls `/api/*` endpoints)

Modules and their purpose:
- `Vision-board/` — Generates Roman Pichler Vision Boards via Claude
- `intelligence-hub/` — Collects raw product intel (data-entry), runs AI analysis (analyzer), and shows history; persists data to `intelligence-hub.json` and `History/` as timestamped JSON files
- `meeting-strategist/` — Meeting preparation tool
- `story-grooming/` — User story refinement; saves stories to `Modules/Backlog/` as timestamped JSON files
- `Backlog/` — Read-only view of saved stories from `Modules/Backlog/*.json`
- `settings/` — Shared configuration (personas, clients, user story template, acceptance criteria template); saved to `Modules/Settings/settings.json`

### Shared CSS

Tailwind CSS is compiled from `shared/style.css` into `shared/style.generated.css` via PostCSS (`scripts/build-css.js`). Module HTML files reference `style.generated.css`. Commit the generated file after changes.

### Data persistence

No database. All data is stored as JSON files on disk:
- `Modules/Settings/settings.json` — global settings (personas, clients, templates)
- `Modules/Intelligence-hub/intelligence-hub.json` — intelligence entries
- `Modules/Intelligence-hub/History/` — per-analysis snapshots (`analysis-*.json`, `radar-*.json`)
- `Modules/Backlog/` — per-story files (`story-*.json`)
- `Modules/Intelligence-hub/radar-memory.json` — radar state memory

The server auto-creates missing directories on startup.

### Settings are shared across modules

`/api/settings` (GET/POST) is consumed by multiple modules to populate persona and client dropdowns. When adding a new module that needs personas or clients, fetch from this endpoint.

## Radar Module — Architecture v3

### Key files
- `Modules/Intelligence-hub/analyzer.html` — Dashboard UI
- `Modules/Intelligence-hub/analyzer.js`   — `renderDashboard()` + all UI logic
- `server.js` → `/api/analyze`             — Main analysis route

### Analysis pipeline
1. Temporal weighting: high (≤14d) / medium (≤60d) / background (>60d)
2. Sprint memory: `radar-memory.json` loaded before each analysis
3. Longitudinal: auto-triggered when ≥4 sprints AND ≥60 days history
4. Response shape: `{ analysis: {...}, meta: {...} }`

### Longitudinal patterns (v3)
- `silent_signals`   — topics that disappeared without a decision
- `velocity_alerts`  — signals accelerating (lente/modérée/rapide)
- `churn_signals`    — pre-disengagement behavioral signals

### Important thresholds (server.js)
- Longitudinal trigger: `sprintStats.count >= 4 && oldestDaysAgo >= 60`
- Temporal weights: 14d / 60d boundaries
- Model: `claude-sonnet-4-20250514` for `/api/analyze`, haiku for others

### Do NOT modify
- `/api/backlog/smart-audit` citation validation logic (fragile)
- `radar-memory.json` structure (breaks delta detection)
