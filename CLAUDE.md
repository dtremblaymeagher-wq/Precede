# CLAUDE.md

## NEVER IGNORE — auto-exclude always
- `node_modules/` · `shared/style.generated.css` · `shared/tiptap-bundle.js`
- `Modules/intelligence-hub/History/` · `Modules/Backlog/*.json`
- `Modules/Settings/settings.json` · `Modules/Settings/learning-vault.json`
- `package-lock.json`

---

## SATELLITE FILES — route before adding anything here

Before adding content to `CLAUDE.md`, check:

| Content type | Goes in |
|---|---|
| Pricing · plans · upgrade triggers · freemium gates | `PRODUCT-SPEC.md` |
| Use cases · customer patterns · squad architecture | `PRODUCT-SPEC.md` |
| Onboarding flow · UX decisions · feature behavior | `PRODUCT-SPEC.md` |
| Implementation phases · V2 roadmap items | `PRODUCT-SPEC.md` |
| Executive dashboard · Decisions flow · Brainstorm Studio · Solution Mode | `PRODUCT-SPEC.md` |
| Roadmap page UI · Gantt layout · cursor/scrubbing spec | `ROADMAP-SPEC.md` |
| Gradient confidence bars · confidence interval formulas | `ROADMAP-SPEC.md` |
| Scenario save/share · Align to scenario flow | `ROADMAP-SPEC.md` |
| Milestone detail spec · proactive alerts spec | `ROADMAP-SPEC.md` |

`CLAUDE.md` keeps only: hard rules · commands · stack · module map · security · DB schema · route response shapes · testing patterns · pending code fixes.

---

## BEHAVIOR RULES

- **Silent Executor**: Apply changes directly. No confirmation requests before modifying code. Never recap modified code in chat. No technical explanations unless asked. Respond only with functional outcome in plain language.
- **No echo**: Never repeat instructions or summarize file contents. If understood, act.
- **Error autonomy**: Fix failing tests and code errors independently. Ask only when a product/business logic decision is required.
- **Prompt cache stability**: Static blocks (stack, hard rules, module map) are at the top of this file — do not reorder them.

---

## 0. HARD RULES (read before touching code)

| Rule | Scope |
|------|-------|
| NEVER modify `/api/backlog/smart-audit` citation validation | fragile, breaks silently |
| NEVER modify `radar-memory.json` structure | breaks delta detection |
| NEVER modify `/api/analyze` monolith — propose split instead | see §7 |
| NEVER remove `analysis_type = 'full'` | used by Radar dashboard |
| NEVER push epic-level rank to Jira — story-level only | stories are interleaved |
| NEVER create `executive_roadmap_items` table | milestone table covers it |
| NEVER call Claude API from browser | API key must stay server-side |
| NEVER add link to `index.html` in sidebars | page is deprecated |
| ALWAYS pass `callType` to every `callAI()` call | required for `api_usage_logs` — logging is automatic but only fires when `callType` is set |
| Ask before modifying more than 1 file at a time in story-grooming | |

---

## 1. COMMANDS

```bash
node server.js          # dev server → http://localhost:3001
npm run build:css       # shared/style.css → shared/style.generated.css
npm test                # jest --runInBand (all tests)
npm test -- --testPathPattern=<name>  # single file
```

---

## 2. STACK

```
Browser → server.js (Express, port 3001) → Anthropic Claude API
                    ↓
              Supabase (Postgres)
              Clerk (auth)
```

- Frontend: vanilla HTML/CSS/JS · Tailwind (compiled)
- Auth: `@clerk/express` · `requireAuth()` on all `/api/*`
- Instance middleware: `resolveInstance` validates `X-Instance-Id` header → `req.instanceId`
- No linter · no legacy test suite (new tests in `/tests/` via Jest+Supertest)
- **Clerk publishable key** (`pk_test_...`) hardcoded in all HTML files — this is **intentional and safe**: Clerk publishable keys are designed to be public (they identify the app, not a secret). The production key swap is handled by `server.js` at runtime. Do NOT confuse with `CLERK_SECRET_KEY` (in `.env`, never committed).

---

## 3. MODULE MAP

```
server.js               main Express app + all routes (export: { app })
routes/
  roadmap-routes.js     GET /api/roadmap/{epics,velocity,projection,scenarios}
  exec-routes.js        GET /api/exec/*
integrations/
  jira.js               Jira REST client
  jira-story-importer.js  batch import
database/db.js          Supabase client (singleton)
Modules/
  intelligence-hub/     analyzer.html+js · data-entry.html+js · history.html+js
  story-grooming/       grooming UI
  Backlog/              read-only backlog view
  meeting-strategist/   meeting prep
  Vision-board/         helper only — NOT in main sidebar
  settings/             shared config (personas, clients, templates, OKRs)
shared/
  style.css             Tailwind source → build before commit
  auth.js               shared Clerk helpers
```

**Sidebar home:** `dashboard.html` (label "🏠 Home") — not `index.html`

**Vision Board:** accessible only via Settings button, not sidebar nav.

---

## 4. SECURITY — INSTANCE ISOLATION [CRITICAL]

Every DB query on instance-scoped data MUST filter by both `user_id` AND `instance_id`.

```js
// resolveInstance middleware (already in server.js)
// Validates X-Instance-Id header belongs to authenticated user → req.instanceId
// Returns 400 if header missing · 403 if wrong owner
// Skipped for paths listed in INSTANCE_FREE_PATHS (server.js) — that array is the source of truth
```

Each Claude API call must include ONLY context from the active instance. No cross-instance data.

Supabase RLS: all tables must have RLS policy filtering by `user_id` + `instance_id`.

---

## 5. DATABASE — INSTANCE TABLES

All existing tables need `instance_id uuid NOT NULL` (already done in live code):
`intelligence_entries` · `analysis_history` · `radar_memory` · `backlog_stories` · `vision` · `settings` · `learning_vault` · `integrations` · `sprint_exceptions` · `meeting_prep_history`

**New tables (Phase 2+):**

```sql
CREATE TABLE instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  name text NOT NULL,
  color text,
  jira_mode text DEFAULT 'full_sync', -- 'full_sync' | 'push_only'
  pm_tenure_start date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE jira_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id text, created_by text NOT NULL,
  url text NOT NULL, credentials jsonb NOT NULL,
  name text, shared boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE instance_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL,
  from_user_id text NOT NULL, to_user_id text NOT NULL,
  status text DEFAULT 'pending', conversation jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE roadmap_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL, user_id text NOT NULL,
  name text NOT NULL, note text,
  epic_order jsonb NOT NULL,
  visibility text DEFAULT 'private', share_token text UNIQUE,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE roadmap_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL, user_id text NOT NULL,
  type text NOT NULL, severity text NOT NULL,
  epic_id text, message text NOT NULL, context jsonb,
  read boolean DEFAULT false, created_at timestamptz DEFAULT now()
);
```

---

## 6. ROADMAP MODULE

**Files:** `roadmap.html` · `roadmap.js` · `routes/roadmap-routes.js`

**Routes:** `GET /api/roadmap/epics` · `/velocity` · `/projection` · `/scenarios`

**Response shapes:**
- `/epics` → `[{ id, name, phase, stories: {total,completed,remaining}, avgPosition, ... }]`
- `/velocity` → `{ avgStoriesPerSprint, carryOverRate, lowConfidence, velocityByEpic, ... }`
- `/projection` → `{ projections: [{ epicId, projection: { bestCase, mostLikely, worstCase } }], lowConfidence, activeSprint }`

**Velocity model (V1 — already implemented in roadmap-routes.js):**
- Effective velocity = rawVelocity × (1-carryOver) × featurePct × priorityShare
- Priority shares: P1=48% · P2=29% · P3=16% · P4+=7%
- Scope creep defaults: Discovery=50% · Refinement=20% · Dev=10% · Completion=3%

**Jira sync rules:**
- ✅ Update story counts, completed stories, velocity model
- ❌ NEVER modify Jira backlog order or epic rank

**Jira push rules (Align to scenario):**
- ✅ Individual story `Rank` field update — 1 story at a time, PM confirms each
- ❌ Bulk reorder · epic-level rank changes · backlog override
-  Show warning: "This will modify your Jira backlog. Changes cannot be automatically undone."
  
**Milestone confidence alert:** auto-generate Decision Required when confidence < 50% with < 3 sprints to deadline.

---

## 7. ANALYSIS / RADAR MODULE

**Files:** `Modules/intelligence-hub/analyzer.html` · `analyzer.js` · `server.js → /api/analyze`

**Pipeline:**
1. Temporal weights: high ≤14d · medium ≤60d · background >60d
2. Load `radar_memory` (sprint delta)
3. Longitudinal auto-trigger: `sprintStats.count >= 4 && oldestDaysAgo >= 60`
4. Single Claude call (model: `claude-sonnet-4-20250514`)
5. Save to `analysis_history` (type=`'full'`) + upsert `radar_memory`

**Response:** `{ analysis: { summary, trends, okr_alignment, delta, longitudinal, ... }, meta: { longitudinal_triggered, memory_used, ... } }`

**Longitudinal patterns:** `silent_signals` · `velocity_alerts` · `churn_signals`

**MODULAR SPLIT RULE:**
`/api/analyze` is a working monolith — do NOT modify it.
For any improvement request → propose a new route instead:
- `/api/analyze/signals` → trends + sentiment
- `/api/analyze/delta` → sprint delta
- `/api/analyze/longitudinal` → silent signals, velocity, churn
- `/api/analyze/alignment` → OKR alignment + strategic gap

`analysis_history.analysis_type`: `'full'` (default) | `'signals'` | `'delta'` | `'longitudinal'` | `'alignment'`

---

## 8. PENDING FIXES

_(none)_

---

## 10. PRE-DEPLOY CHECKLIST

| Item | Action |
|------|--------|
| **CORS** | Add production URL to `ALLOWED_ORIGINS` env var on the host — e.g. `http://localhost:3001,https://your-app.com`. Currently only `localhost:3001` is whitelisted. |

---

## 9. TESTING

**Stack:** Jest + Supertest · files in `/tests/` · `[feature].test.js`

**Every new route requires:**
- Happy path → 200
- No Clerk token → 401
- Missing `X-Instance-Id` → 400
- Wrong `instance_id` (other user) → 403
- Missing required fields → 400
- Instance isolation: user A cannot read user B's data

**Claude API parsing:** test valid JSON · malformed JSON (no crash) · missing fields (graceful degrade)

**Run:** `npm test` · `npm test -- --testPathPattern=<name>`

**Mock pattern:**
- Clerk: `Authorization: Bearer <userId>` → `getAuth(req).userId`
- Supabase: queue-based mock via `db.__q([...responses])`
- `resolveInstance` always consumes queue slot 0 in protected routes
- `.single()`/`.maybeSingle()` consume synchronously; `await chain` consumes via microtask

---

