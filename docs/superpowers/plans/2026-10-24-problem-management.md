# Problem Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Problem Management module with problems, known errors, incident linking, RCA (5 Whys + Fishbone), workaround tracking, change integration, dual-mode detection (BullMQ + manual), and dashboards.

**Architecture:** Follows existing Phase 5 patterns: Prisma models → service layer → validators → routes → client API → React pages with TanStack Query. BullMQ worker for background detection, Socket.IO for real-time updates. Modular detection logic with Redis fallback.

**Tech Stack:** React 18 + Vite + Tailwind v4 + TanStack Query · Express + Prisma + Supabase Postgres · BullMQ (Redis) · Socket.IO · Recharts (dashboards)

**Spec:** `docs/superpowers/specs/2026-10-24-problem-management-design.md`

---

## Global Constraints

- Database: Supabase Postgres (relational) via Prisma — `DATABASE_URL`
- Redis / Jobs: Render Key Value (Redis) via `REDIS_URL`; BullMQ for queues
- File Storage: Supabase Storage private bucket (service key server-side only)
- Auth: JWT sessions, refresh rotation, RBAC middleware
- UI: Design tokens via `ui-ux-pro-max`; dark/light; responsive; keyboard-accessible
- Tests: Vitest (API/unit) + Playwright (e2e); test schema on Supabase
- Commits: Ask before commit/push; no co-author lines
- Number format: `PRB-YYYY-NNNNNN` for problems, `KE-YYYY-NNNNNN` for known errors
- Detection threshold: 75 (configurable), interval: 15 min (configurable)

---

## Review Focus

| Input Class / Failure Mode | Expected Behavior | Test Task |
|---|---|---|
| Duplicate problem creation for same underlying issue | Detection suggests matches; technician must confirm; automation rules only auto-create with explicit permission | Task 3 (detection) |
| Problem marked "Resolved" without verified fix | Status transition validation requires `resolutionSummary` + (`verifiedFix=true` OR `exceptionReason`); exception requires manager role | Task 2 (status transitions) |
| Known Error published without approval | Status transition `DRAFT` → `UNDER_REVIEW` → `PUBLISHED` requires `known_errors:approve` role | Task 5 (known errors) |
| Background detection runs when Redis unavailable | Feature flag `PROBLEM_REDIS_FALLBACK` enables on-demand API detection; BullMQ worker gracefully skipped | Task 3 (detection) |
| Change rollback doesn't reopen problem | Change event consumer emits notification; problem owner manually reopens or automation rule triggers reopen | Task 4 (change integration) |

---

## Task 1: Prisma Schema & Migration

**Files:**
- Create: `server/prisma/schema.prisma` (modify — add models)
- Create: `server/prisma/migrations/20261024000000_problem_management/migration.sql`
- Test: `server/tests/problems.schema.spec.ts`

**Interfaces:**
- Consumes: existing `User`, `Ticket` (incident) models
- Produces: `Problem`, `ProblemIncident`, `KnownError`, `ProblemRCA`, `ProblemAuditLog`, `DetectionSuggestion` models

- [ ] **Step 1: Write failing schema test**

```typescript
// server/tests/problems.schema.spec.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

test('Problem model creates with all fields', async () => {
  const problem = await prisma.problem.create({
    data: {
      number: 'PRB-2026-000001',
      title: 'Network disconnections',
      description: 'Multiple users report intermittent connectivity',
      ownerId: 'test-user-id',
      status: 'IDENTIFIED',
      priority: 'HIGH',
    },
  });
  expect(problem.id).toBeDefined();
  expect(problem.number).toBe('PRB-2026-000001');
});

test('ProblemIncident links problem to incident', async () => {
  const link = await prisma.problemIncident.create({
    data: {
      problemId: 'test-problem-id',
      incidentId: 'test-incident-id',
      linkedById: 'test-user-id',
    },
  });
  expect(link.id).toBeDefined();
});

test('KnownError model creates with lifecycle fields', async () => {
  const ke = await prisma.knownError.create({
    data: {
      number: 'KE-2026-000001',
      title: 'Network driver issue',
      problemId: 'test-problem-id',
      rootCause: 'Faulty NIC driver v2.1',
      symptoms: 'Intermittent disconnects under load',
      workaround: 'Rollback to driver v1.8',
      ownerId: 'test-user-id',
      status: 'DRAFT',
      visibility: 'IT_ONLY',
    },
  });
  expect(ke.id).toBeDefined();
  expect(ke.number).toBe('KE-2026-000001');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/problems.schema.spec.ts`
Expected: FAIL — models don't exist yet

- [ ] **Step 3: Add models to `server/prisma/schema.prisma`**

Add enums and models from spec Section 4 (Problem, ProblemIncident, KnownError, ProblemRCA, ProblemAuditLog, DetectionSuggestion). Add relations to existing `User` and `Ticket` models.

- [ ] **Step 4: Generate migration**

Run: `cd server && npx prisma migrate dev --name problem_management --schema=prisma/schema.prisma`
Expected: Migration file created in `prisma/migrations/20261024000000_problem_management/`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run tests/problems.schema.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20261024000000_problem_management/ server/tests/problems.schema.spec.ts
git commit -m "feat(problems): add Prisma models for Problem, KnownError, detection"
```

---

## Task 2: Problem Service Layer (Core CRUD + Status Transitions)

**Files:**
- Create: `server/src/modules/problems/problems.service.ts`
- Create: `server/src/modules/problems/problems.routes.ts`
- Create: `server/src/modules/problems/validators.ts`
- Create: `server/src/modules/problems/numberGenerator.ts`
- Create: `server/src/modules/problems/config.ts`
- Create: `server/src/modules/problems/detection/` (folder for Task 3)
- Modify: `server/src/app.ts` (register routes)
- Modify: `server/src/core/permissions.ts` (add problem permissions)
- Test: `server/tests/problems.service.spec.ts`

**Interfaces:**
- Consumes: Prisma client, `User`, `Ticket` models, `systemSettings` service
- Produces: `ProblemsService` class with methods:
  - `list(query: ListProblemsQuery): Promise<Paginated<ProblemSummary>>`
  - `get(id: string): Promise<ProblemDetail>`
  - `create(input: CreateProblemInput, actorId: string): Promise<Problem>`
  - `update(id: string, input: UpdateProblemInput, actorId: string): Promise<Problem>`
  - `transitionStatus(id: string, status: ProblemStatus, actorId: string, extra?: object): Promise<Problem>`
  - `linkIncidents(id: string, incidentIds: string[], actorId: string, note?: string): Promise<void>`
  - `unlinkIncident(id: string, incidentId: string, actorId: string): Promise<void>`
  - `updateRCA(id: string, input: UpdateRCAInput, actorId: string): Promise<Problem>`
  - `setWorkaround(id: string, workaround: string, actorId: string): Promise<Problem>`
  - `linkChangeRequest(id: string, changeId: string, actorId: string): Promise<Problem>`
  - `unlinkChangeRequest(id: string, changeId: string, actorId: string): Promise<Problem>`
  - `getAuditLog(id: string): Promise<ProblemAuditLog[]>`

- [ ] **Step 1: Write failing service tests**

```typescript
// server/tests/problems.service.spec.ts
import { ProblemsService } from '../src/modules/problems/problems.service';

test('createProblem generates PRB number and sets identifiedAt', async () => {
  const problem = await service.create({
    title: 'Test problem',
    description: 'Desc',
    ownerId: 'user-1',
    priority: 'HIGH',
  }, 'user-1');
  expect(problem.number).toMatch(/^PRB-\d{4}-\d{6}$/);
  expect(problem.status).toBe('IDENTIFIED');
  expect(problem.identifiedAt).toBeInstanceOf(Date);
});

test('transitionStatus validates ROOT_CAUSE_KNOWN requires confirmedRootCause', async () => {
  const problem = await service.create({ title: 'T', description: 'D', ownerId: 'u1' }, 'u1');
  await expect(service.transitionStatus(problem.id, 'ROOT_CAUSE_KNOWN', 'u1'))
    .rejects.toThrow('Root cause must be documented and confirmed');
});

test('transitionStatus allows ROOT_CAUSE_KNOWN with rootCause + confirmedRootCause', async () => {
  const problem = await service.create({ title: 'T', description: 'D', ownerId: 'u1' }, 'u1');
  await service.updateRCA(problem.id, { rootCause: 'Cause', confirmedRootCause: true }, 'u1');
  const updated = await service.transitionStatus(problem.id, 'ROOT_CAUSE_KNOWN', 'u1');
  expect(updated.status).toBe('ROOT_CAUSE_KNOWN');
  expect(updated.rootCauseIdentifiedAt).toBeInstanceOf(Date);
});

test('linkIncidents creates ProblemIncident records with audit', async () => {
  const problem = await service.create({ title: 'T', description: 'D', ownerId: 'u1' }, 'u1');
  await service.linkIncidents(problem.id, ['inc-1', 'inc-2'], 'u1', 'Related by symptom');
  const detail = await service.get(problem.id);
  expect(detail.incidents).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/problems.service.spec.ts`
Expected: FAIL — service doesn't exist

- [ ] **Step 3: Implement `validators.ts`**

Zod schemas for: `CreateProblemInput`, `UpdateProblemInput`, `ListProblemsQuery`, `TransitionStatusInput`, `UpdateRCAInput`, `LinkIncidentsInput`, `LinkChangeRequestInput`. Include status transition validation rules from spec Section 7.

- [ ] **Step 4: Implement `numberGenerator.ts`**

`generateProblemNumber(tx): Promise<string>` — atomic increment in transaction, format `PRB-YYYY-NNNNNN`. Same for `generateKnownErrorNumber(tx)` → `KE-YYYY-NNNNNN`.

- [ ] **Step 5: Implement `config.ts`**

Feature flag getters reading from `system_settings` with defaults (spec Section 11).

- [ ] **Step 6: Implement `problems.service.ts`**

Full service class with all methods. Use transactions for multi-table operations (create + audit, link + audit). Emit Socket.IO events on status change, incident link, detection suggestion.

- [ ] **Step 7: Implement `problems.routes.ts`**

REST endpoints from spec Section 5.1, 5.2. Apply RBAC middleware (`requirePermission('problems:read')`, etc.).

- [ ] **Step 8: Register routes in `server/src/app.ts`**

Add `app.use('/api/v1/problems', problemsRoutes)`.

- [ ] **Step 9: Add permissions to `server/src/core/permissions.ts`**

Add `problems:read`, `problems:create`, `problems:update`, `problems:transition`, `problems:link_incidents`, `problems:manage_rca` to permission catalog with role mappings from spec Section 8.

- [ ] **Step 10: Run test to verify it passes**

Run: `cd server && npx vitest run tests/problems.service.spec.ts`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add server/src/modules/problems/ server/src/app.ts server/src/core/permissions.ts server/tests/problems.service.spec.ts
git commit -m "feat(problems): service layer, routes, validators, RBAC, number generator"
```

---

## Task 3: Detection Engine + BullMQ Worker

**Files:**
- Create: `server/src/modules/problems/detection/criteria.ts`
- Create: `server/src/modules/problems/detection/scoring.ts`
- Create: `server/src/modules/problems/detection/detectionEngine.ts`
- Create: `server/src/modules/problems/detection/detectionWorker.ts`
- Create: `server/src/modules/problems/detection/detection.routes.ts`
- Modify: `server/src/jobs/scheduler.ts` (register repeatable job)
- Test: `server/tests/problems.detection.spec.ts`

**Interfaces:**
- Consumes: `Ticket` (incident) model, `Problem` model, `systemSettings` for thresholds
- Produces: Pure functions `scoreIncidentAgainstProblems()`, `findSimilarProblems()`, `createDetectionSuggestions()`; BullMQ worker `problem-detection`; API endpoint `GET /problems/detect`, `POST /problems/from-incidents`

- [ ] **Step 1: Write failing detection tests**

```typescript
// server/tests/problems.detection.spec.ts
import { scoreIncidentAgainstProblem, findSimilarProblems } from '../src/modules/problems/detection/scoring';

test('exact match on service + category + asset scores 100', () => {
  const incident = { service: 'Network', category: 'Connectivity', assetId: 'asset-1', symptoms: 'disconnect' };
  const problem = { affectedServices: ['Network'], affectedAssets: ['asset-1'] };
  expect(scoreIncidentAgainstProblem(incident, problem)).toBe(100);
});

test('fuzzy symptom similarity adds partial score', () => {
  const incident = { symptoms: 'network disconnect intermittent' };
  const problem = { affectedServices: ['Network'] };
  const score = scoreIncidentAgainstProblem(incident, problem);
  expect(score).toBeGreaterThan(50);
  expect(score).toBeLessThan(100);
});

test('time pattern: 3+ same category in 24h boosts score', () => {
  const incidents = Array(3).fill({ category: 'Connectivity', createdAt: new Date() });
  const boost = timePatternBoost(incidents, 'Connectivity');
  expect(boost).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/problems.detection.spec.ts`
Expected: FAIL — detection module doesn't exist

- [ ] **Step 3: Implement `criteria.ts`**

Configuration constants: match fields, weights, threshold, time windows. Export `DetectionCriteria` interface.

- [ ] **Step 4: Implement `scoring.ts`**

Pure functions: `scoreIncidentAgainstProblem()`, `timePatternBoost()`, `symptomSimilarity()` (trigram or simple token overlap). No external dependencies.

- [ ] **Step 5: Implement `detectionEngine.ts`**

`runDetection(windowStart: Date): Promise<DetectionSuggestion[]>` — orchestrates fetch incidents → score against open problems → create suggestions. `createProblemFromIncidents(incidentIds: string[], actorId: string): Promise<Problem>`.

- [ ] **Step 6: Implement `detectionWorker.ts`**

BullMQ worker for queue `problem-detection`. Repeatable job every `config.detectionIntervalMin` minutes. Calls `detectionEngine.runDetection()`. Handles Redis connection errors gracefully (logs, doesn't crash).

- [ ] **Step 7: Implement `detection.routes.ts`**

`GET /problems/detect` — on-demand detection for manual "Find related". `POST /problems/from-incidents` — create problem from selected incidents. `GET /problems/:id/similar` — duplicate prevention.

- [ ] **Step 8: Register worker in `server/src/jobs/scheduler.ts`**

Add `problemDetectionWorker` to worker array. Register repeatable job with `PROBLEM_DETECTION_ENABLED` flag check.

- [ ] **Step 9: Run test to verify it passes**

Run: `cd server && npx vitest run tests/problems.detection.spec.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add server/src/modules/problems/detection/ server/src/jobs/scheduler.ts server/tests/problems.detection.spec.ts
git commit -m "feat(problems): detection engine, BullMQ worker, API endpoints"
```

---

## Task 4: Change Integration (Event Consumer)

**Files:**
- Create: `server/src/modules/problems/changeConsumer.ts`
- Modify: `server/src/modules/problems/problems.service.ts` (add event handlers)
- Test: `server/tests/problems.changeConsumer.spec.ts`

**Interfaces:**
- Consumes: Change events from `change.events` (via event bus or direct import), `ProblemsService`
- Produces: Event handlers for `change.approved`, `change.implemented`, `change.rejected`, `change.rolled_back`

- [ ] **Step 1: Write failing change consumer tests**

```typescript
// server/tests/problems.changeConsumer.spec.ts
import { handleChangeEvent } from '../src/modules/problems/changeConsumer';

test('change.implemented notifies owner and suggests verification', async () => {
  const problem = await createTestProblem({ changeRequestIds: ['chg-1'] });
  await handleChangeEvent('change.implemented', { changeId: 'chg-1', status: 'IMPLEMENTED' });
  const notifications = await getNotificationsForUser(problem.ownerId);
  expect(notifications).toContainEqual(expect.objectContaining({
    type: 'CHANGE_IMPLEMENTED',
    message: expect.stringContaining('verify the fix'),
  }));
});

test('change.rolled_back offers to reopen problem', async () => {
  const problem = await createTestProblem({ status: 'RESOLVED', changeRequestIds: ['chg-1'] });
  await handleChangeEvent('change.rolled_back', { changeId: 'chg-1' });
  const notifications = await getNotificationsForUser(problem.ownerId);
  expect(notifications).toContainEqual(expect.objectContaining({
    type: 'CHANGE_ROLLED_BACK',
    message: expect.stringContaining('reopen'),
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/problems.changeConsumer.spec.ts`
Expected: FAIL — consumer doesn't exist

- [ ] **Step 3: Implement `changeConsumer.ts`**

Subscribe to change events (use existing event bus pattern from `approvals` module). Handlers:
- `change.approved` → notify owner, no status change
- `change.implemented` → notify owner, add verification prompt
- `change.rejected` → notify owner
- `change.rolled_back` → notify owner, if problem was `RESOLVED` offer reopen to `INVESTIGATION`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/problems.changeConsumer.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/problems/changeConsumer.ts server/tests/problems.changeConsumer.spec.ts
git commit -m "feat(problems): change event consumer for status awareness"
```

---

## Task 5: Known Error Service + Routes

**Files:**
- Create: `server/src/modules/known-errors/knownErrors.service.ts`
- Create: `server/src/modules/known-errors/knownErrors.routes.ts`
- Create: `server/src/modules/known-errors/validators.ts`
- Create: `server/src/modules/known-errors/numberGenerator.ts`
- Modify: `server/src/app.ts` (register routes)
- Modify: `server/src/core/permissions.ts` (add known_errors permissions)
- Test: `server/tests/knownErrors.service.spec.ts`

**Interfaces:**
- Consumes: `Problem` model, `KnowledgeArticle` model (for KB publish)
- Produces: `KnownErrorsService` with CRUD + status transitions + KB publish

- [ ] **Step 1: Write failing known error tests**

```typescript
// server/tests/knownErrors.service.spec.ts
import { KnownErrorsService } from '../src/modules/known-errors/knownErrors.service';

test('createKnownError generates KE number and links problem', async () => {
  const ke = await service.create({
    problemId: 'prob-1',
    title: 'Network driver workaround',
    rootCause: 'Faulty driver',
    symptoms: 'Disconnects',
    workaround: 'Rollback driver',
    ownerId: 'user-1',
  }, 'user-1');
  expect(ke.number).toMatch(/^KE-\d{4}-\d{6}$/);
  expect(ke.status).toBe('DRAFT');
  expect(ke.visibility).toBe('IT_ONLY');
});

test('status transition DRAFT -> UNDER_REVIEW requires approver role', async () => {
  const ke = await service.create({ problemId: 'p1', title: 'T', rootCause: 'C', symptoms: 'S', workaround: 'W', ownerId: 'u1' }, 'u1');
  await expect(service.transitionStatus(ke.id, 'UNDER_REVIEW', 'technician-user'))
    .rejects.toThrow('Insufficient permissions');
});

test('publishKB creates knowledge article and links it', async () => {
  const ke = await service.create({ problemId: 'p1', title: 'T', rootCause: 'C', symptoms: 'S', workaround: 'W', ownerId: 'u1' }, 'u1');
  await service.transitionStatus(ke.id, 'PUBLISHED', 'manager-user');
  const published = await service.publishKB(ke.id, 'manager-user');
  expect(published.publishedArticleId).toBeDefined();
  expect(published.visibility).toBe('EMPLOYEE_SELF_SERVICE');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/knownErrors.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement validators, numberGenerator, service, routes**

Follow same pattern as Task 2. Status transitions: `DRAFT` → `UNDER_REVIEW` → `PUBLISHED` → `RETIRED`. Validation: `PUBLISHED` requires `approvedBy`, `approvedAt`. KB publish creates `KnowledgeArticle` with workaround content, visibility `PUBLIC` or `INTERNAL`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/knownErrors.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/known-errors/ server/src/app.ts server/src/core/permissions.ts server/tests/knownErrors.service.spec.ts
git commit -m "feat(known-errors): service, routes, validators, approval workflow, KB integration"
```

---

## Task 6: Client API Layer

**Files:**
- Create: `client/src/lib/problemApi.ts`
- Test: (manual verification via UI in later tasks)

**Interfaces:**
- Consumes: Server REST API (Tasks 2, 3, 4, 5)
- Produces: `problemApi` object with:
  - `list(query)`, `get(id)`, `create(input)`, `update(id, input)`
  - `transitionStatus(id, status, extra?)`
  - `linkIncidents(id, incidentIds, note?)`, `unlinkIncident(id, incidentId)`
  - `updateRCA(id, input)`, `setWorkaround(id, workaround)`
  - `linkChangeRequest(id, changeId)`, `unlinkChangeRequest(id, changeId)`
  - `getAuditLog(id)`
  - `detect(query)`, `createFromIncidents(incidentIds)`
  - `getSimilar(id)`
  - Known error: `listKnownErrors(query)`, `getKnownError(id)`, `createKnownError(input)`, `updateKnownError(id, input)`, `transitionKnownErrorStatus(id, status)`, `publishKnownErrorKB(id)`, `searchKnownErrors(query)`
  - Types: `ProblemSummary`, `ProblemDetail`, `ProblemIncident`, `ProblemRCA`, `ProblemAuditLog`, `DetectionSuggestion`, `KnownError`, `KnownErrorSummary`, `ListProblemsQuery`, `CreateProblemInput`, `UpdateProblemInput`, `UpdateRCAInput`, `CreateKnownErrorInput`, `UpdateKnownErrorInput`
  - Helpers: `getProblemStatusBadgeClass()`, `getKnownErrorStatusBadgeClass()`, `formatProblemNumber()`

- [ ] **Step 1: Implement `problemApi.ts`**

Follow `knowledgeApi.ts` pattern. Use `apiClient` from `@/lib/api`. Define all types and query keys. TanStack Query hooks: `useProblems(query)`, `useProblem(id)`, `useKnownErrors(query)`, `useKnownError(id)`.

- [ ] **Step 2: Manual verification**

Start dev server, open browser console, test `problemApi.list({})` returns expected shape.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/problemApi.ts
git commit -m "feat(problems): client API layer with types and TanStack Query hooks"
```

---

## Task 7: Phase 1 UI — Problem List & Detail Pages

**Files:**
- Create: `client/src/pages/ProblemsPage.tsx`
- Create: `client/src/pages/ProblemDetailPage.tsx`
- Create: `client/src/pages/ProblemCreatePage.tsx`
- Create: `client/src/components/problems/ProblemIncidentsTable.tsx`
- Create: `client/src/components/problems/RCAForms.tsx`
- Create: `client/src/components/problems/WorkaroundEditor.tsx`
- Create: `client/src/components/problems/ChangesPanel.tsx`
- Create: `client/src/components/problems/AuditLogPanel.tsx`
- Modify: `client/src/components/icons.tsx` (add icons)
- Modify: `client/src/lib/nav.ts` (add Problems nav item)
- Modify: `client/src/App.tsx` (add routes)
- Test: `client/tests/phase5-problems.spec.ts` (Playwright)

**Interfaces:**
- Consumes: `problemApi` (Task 6), `useAuth`, `ui-ux-pro-max` design tokens
- Produces: Pages at `/problems` (list), `/problems/new` (create), `/problems/:id` (detail with tabs)

- [ ] **Step 1: Add icons to `icons.tsx`**

`BugIcon`, `SearchIcon` (exists), `LinkIcon`, `UnlinkIcon`, `BrainIcon` (RCA), `WrenchIcon` (workaround), `GitBranchIcon` (changes), `HistoryIcon` (audit), `AlertTriangleIcon` (detection), `BookOpenIcon` (known error).

- [ ] **Step 2: Add nav item to `nav.ts`**

`{ label: 'Problems', to: '/problems', icon: BugIcon, permissions: ['problems:read'], section: 'work' }`

- [ ] **Step 3: Add routes to `App.tsx`**

`/problems` (problems:read), `/problems/new` (problems:create), `/problems/:id` (problems:read).

- [ ] **Step 4: Implement `ProblemsPage.tsx`**

List with filters (status, priority, owner, service, date range), pagination, skeleton loading, "New Problem" button. Uses `useProblems(query)`.

- [ ] **Step 5: Implement `ProblemCreatePage.tsx`**

Form: title, description, priority, owner (select), affected services/assets/CIs (multi-select), business impact. Submit → redirect to detail.

- [ ] **Step 6: Implement `ProblemDetailPage.tsx`**

Header: number, title, status badge, priority badge, owner. Tabs: Overview, Incidents, Investigation, Workaround, Changes, Audit. Each tab component in separate file.

- [ ] **Step 7: Implement `ProblemIncidentsTable.tsx`**

Table with incident number, title, status, requester, linkedAt. Actions: "Unlink". "Find Related" button opens modal (Task 8).

- [ ] **Step 8: Implement `RCAForms.tsx`**

Radio: 5 Whys / Fishbone / Notes. 5 Whys: dynamic steps (add/remove), each with question + answer. Fishbone: 6 category inputs + root cause field. Notes: textarea. Validation: `ROOT_CAUSE_KNOWN` requires confirmed root cause.

- [ ] **Step 9: Implement `WorkaroundEditor.tsx`**

Rich text (or markdown) editor for workaround. "Create Known Error" button (enabled when workaround filled).

- [ ] **Step 10: Implement `ChangesPanel.tsx`**

List linked change requests with status badges. "Link Change" button (search modal). Shows change status from API.

- [ ] **Step 11: Implement `AuditLogPanel.tsx`**

Immutable table: timestamp, action, actor, old→new values (formatted).

- [ ] **Step 12: Write Playwright tests**

`client/tests/phase5-problems.spec.ts` — list loads, create problem, link incidents, RCA forms, workaround, change linking, audit log.

- [ ] **Step 13: Run Playwright tests**

Run: `cd client && npx playwright test tests/phase5-problems.spec.ts --headed`
Expected: PASS (17+ tests)

- [ ] **Step 14: Commit**

```bash
git add client/src/pages/ProblemsPage.tsx client/src/pages/ProblemDetailPage.tsx client/src/pages/ProblemCreatePage.tsx client/src/components/problems/ client/src/components/icons.tsx client/src/lib/nav.ts client/src/App.tsx client/tests/phase5-problems.spec.ts
git commit -m "feat(problems): Phase 1 UI — list, detail, create, RCA forms, incidents, changes, audit"
```

---

## Task 8: Phase 2 UI — Detection Suggestions & "Find Related"

**Files:**
- Create: `client/src/components/problems/DetectionSuggestionsPanel.tsx`
- Create: `client/src/components/problems/FindRelatedModal.tsx`
- Modify: `client/src/pages/ProblemsPage.tsx` (add suggestions panel)
- Modify: `client/src/pages/TicketDetailPage.tsx` (add "Find Related" button on incident detail)
- Test: `client/tests/phase5-problems.spec.ts` (add detection tests)

**Interfaces:**
- Consumes: `problemApi.detect()`, `problemApi.createFromIncidents()`, `problemApi.getSimilar()`
- Produces: Suggestions panel (sidebar/toast), modal for manual incident search

- [ ] **Step 1: Implement `DetectionSuggestionsPanel.tsx`**

Shows pending `DetectionSuggestion` records for current user. Each: score, matched incidents, reasons. Actions: "Accept" (creates problem + links), "Reject", "Dismiss".

- [ ] **Step 2: Implement `FindRelatedModal.tsx`**

Search incidents by: service, category, asset, symptom text, date range. Results table with checkboxes. "Create Problem" button → calls `createFromIncidents()`.

- [ ] **Step 3: Add to ProblemsPage and TicketDetailPage**

ProblemsPage: sidebar panel. TicketDetailPage: "Find Related Problems" button in actions.

- [ ] **Step 4: Add Playwright tests**

Test: detection suggestion appears → accept creates problem → incidents linked. Test: manual find related → select incidents → create problem.

- [ ] **Step 5: Run Playwright tests**

Run: `cd client && npx playwright test tests/phase5-problems.spec.ts --headed`
Expected: PASS (additional tests)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/problems/DetectionSuggestionsPanel.tsx client/src/components/problems/FindRelatedModal.tsx client/src/pages/ProblemsPage.tsx client/src/pages/TicketDetailPage.tsx client/tests/phase5-problems.spec.ts
git commit -m "feat(problems): Phase 2 UI — detection suggestions, Find Related modal"
```

---

## Task 9: Phase 3 UI — Known Error Library

**Files:**
- Create: `client/src/pages/KnownErrorsPage.tsx`
- Create: `client/src/pages/KnownErrorDetailPage.tsx`
- Create: `client/src/pages/KnownErrorCreatePage.tsx`
- Modify: `client/src/lib/nav.ts` (add Known Errors nav)
- Modify: `client/src/App.tsx` (add routes)
- Test: `client/tests/phase5-known-errors.spec.ts`

**Interfaces:**
- Consumes: `problemApi` known error methods
- Produces: `/known-errors` (list), `/known-errors/new` (create from problem), `/known-errors/:id` (detail with approval)

- [ ] **Step 1: Add nav items**

`Known Errors` under `Work` section (permissions: `known_errors:read`). `Create Known Error` under Problems detail.

- [ ] **Step 2: Add routes**

`/known-errors` (known_errors:read), `/known-errors/new` (known_errors:create), `/known-errors/:id` (known_errors:read).

- [ ] **Step 3: Implement list page**

Filters: status, visibility, service. Search. Pagination. "New Known Error" button.

- [ ] **Step 4: Implement detail page**

Header: number, title, status, visibility, owner. Tabs: Details (root cause, symptoms, workaround), Approval (status transitions, approve/reject), Linked (problem, incidents, KB article). "Publish to KB" button for `PUBLISHED` + `EMPLOYEE_SELF_SERVICE`.

- [ ] **Step 5: Implement create page**

Pre-filled from problem (if `?problemId=`). Fields: title, root cause, symptoms, workaround, resolution notes, affected services/assets/CIs, visibility.

- [ ] **Step 6: Write Playwright tests**

List loads, create from problem, approval workflow, KB publish, employee self-service search.

- [ ] **Step 7: Run Playwright tests**

Run: `cd client && npx playwright test tests/phase5-known-errors.spec.ts --headed`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/KnownErrorsPage.tsx client/src/pages/KnownErrorDetailPage.tsx client/src/pages/KnownErrorCreatePage.tsx client/src/lib/nav.ts client/src/App.tsx client/tests/phase5-known-errors.spec.ts
git commit -m "feat(known-errors): Phase 3 UI — library, detail, approval, KB publish"
```

---

## Task 10: Phase 4 UI — Change Integration & Fix Verification

**Files:**
- Modify: `client/src/pages/ProblemDetailPage.tsx` (enhance Changes tab)
- Create: `client/src/components/problems/ChangeLinkModal.tsx`
- Create: `client/src/components/problems/FixVerificationWizard.tsx`
- Test: `client/tests/phase5-problems.spec.ts` (add change integration tests)

**Interfaces:**
- Consumes: `problemApi.linkChangeRequest()`, change status from API, Socket.IO events
- Produces: Change linking modal, fix verification wizard before "Resolved"

- [ ] **Step 1: Implement `ChangeLinkModal.tsx`**

Search changes by ID/title. Select one or more. Shows current status. "Link" button.

- [ ] **Step 2: Implement `FixVerificationWizard.tsx`**

Modal triggered when transitioning to `RESOLVED` with linked changes. Steps: 1) Select change(s) to verify, 2) Confirm fix works (checkbox + notes), 3) Submit → calls `transitionStatus('RESOLVED', { verifiedFix: true })`.

- [ ] **Step 3: Enhance Changes tab**

Show linked changes with real-time status (Socket.IO). "Verify Fix" button when change is `IMPLEMENTED`.

- [ ] **Step 4: Add Playwright tests**

Link change → change implemented → verify fix → resolve. Change rolled back → notification → reopen problem.

- [ ] **Step 5: Run Playwright tests**

Run: `cd client && npx playwright test tests/phase5-problems.spec.ts --headed`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/components/problems/ChangeLinkModal.tsx client/src/components/problems/FixVerificationWizard.tsx client/src/pages/ProblemDetailPage.tsx client/tests/phase5-problems.spec.ts
git commit -m "feat(problems): Phase 4 UI — change linking, fix verification, rollback handling"
```

---

## Task 11: Phase 5 UI — Dashboards

**Files:**
- Create: `client/src/pages/ProblemsDashboardPage.tsx`
- Create: `client/src/components/problems/ProblemCharts.tsx`
- Modify: `client/src/lib/nav.ts` (add Dashboard link)
- Modify: `client/src/App.tsx` (add route)
- Test: `client/tests/phase5-problems.spec.ts` (add dashboard tests)

**Interfaces:**
- Consumes: `problemApi` (aggregated queries or new dashboard endpoint), Recharts
- Produces: `/problems/dashboard` with charts

- [ ] **Step 1: Add dashboard endpoint (server)**

`GET /api/v1/problems/dashboard` — returns aggregated data: recurring trends (time series), top causes (Pareto), aging (bucketed), overdue count, known error usage, fix effectiveness.

- [ ] **Step 2: Implement `ProblemCharts.tsx`**

Recharts components: LineChart (trends), BarChart (Pareto), PieChart (status distribution), RadialBar (overdue%), Table (aging).

- [ ] **Step 3: Implement `ProblemsDashboardPage.tsx`**

Date range picker, refresh button, grid of charts. Skeleton loading.

- [ ] **Step 4: Add nav + route**

Nav: `Problem Dashboard` under `Work` (permissions: `problems:read`). Route: `/problems/dashboard`.

- [ ] **Step 5: Write Playwright tests**

Dashboard loads, charts render, date range filters data.

- [ ] **Step 6: Run Playwright tests**

Run: `cd client && npx playwright test tests/phase5-problems.spec.ts --headed`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/problems/ server/src/app.ts client/src/pages/ProblemsDashboardPage.tsx client/src/components/problems/ProblemCharts.tsx client/src/lib/nav.ts client/src/App.tsx client/tests/phase5-problems.spec.ts
git commit -m "feat(problems): Phase 5 UI — dashboard with Recharts"
```

---

## Task 12: Integration Tests + Seed Data + Polish

**Files:**
- Modify: `server/tests/problems.spec.ts` (full integration suite)
- Modify: `server/prisma/seed.ts` (add demo problems, known errors)
- Modify: `client/tests/phase5-problems.spec.ts` (ensure all E2E pass)
- Test: full test suite

**Interfaces:**
- Consumes: All previous tasks
- Produces: Green test suite, seeded demo data

- [ ] **Step 1: Write integration tests**

`server/tests/problems.spec.ts` — covers all acceptance criteria (spec Section 13): problem creation from incidents, RCA validation, workaround/KE workflow, change linking, detection suggestions, duplicate prevention, RBAC.

- [ ] **Step 2: Add seed data**

In `server/prisma/seed.ts`: create 3-5 demo problems with linked incidents, RCA, workarounds, known errors, linked changes. Use seeded users/incidents.

- [ ] **Step 3: Run full server test suite**

Run: `cd server && npx vitest run`
Expected: All tests pass (including new problem/known error tests)

- [ ] **Step 4: Run full client E2E suite**

Run: `cd client && npx playwright test tests/phase5-problems.spec.ts tests/phase5-known-errors.spec.ts`
Expected: All tests pass

- [ ] **Step 5: Manual smoke test**

Start dev, login as admin, verify: create problem → link incidents → investigate → workaround → known error → approve → publish KB → link change → verify fix → resolve. Verify employee can search known errors.

- [ ] **Step 6: Commit**

```bash
git add server/tests/problems.spec.ts server/prisma/seed.ts client/tests/phase5-problems.spec.ts client/tests/phase5-known-errors.spec.ts
git commit -m "feat(problems): integration tests, seed data, full E2E coverage"
```

---

## Task 13: Update Taskplan & Documentation

**Files:**
- Modify: `taskplan.md` (mark Problem Management complete)
- Modify: `docs/superpowers/specs/2026-10-24-problem-management-design.md` (update status to Approved/Implemented)

**Interfaces:**
- Consumes: Completed implementation
- Produces: Updated tracking documents

- [ ] **Step 1: Update `taskplan.md`**

Change Phase 5 Problem Management line from `[ ]` to `[x]` with summary note.

- [ ] **Step 2: Update design doc status**

Change `Status: Draft for review` to `Status: Implemented`.

- [ ] **Step 3: Commit**

```bash
git add taskplan.md docs/superpowers/specs/2026-10-24-problem-management-design.md
git commit -m "docs: mark Problem Management complete in taskplan and design doc"
```

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-10-24-problem-management.md`.**

This plan has 13 tasks with clear dependencies:
- Tasks 1–2: Foundation (schema, core service) — must complete first
- Task 3: Detection engine (depends on Task 1 models)
- Task 4: Change consumer (depends on Task 2 service)
- Task 5: Known Errors (depends on Task 1 models, Task 2 patterns)
- Task 6: Client API (depends on Tasks 2, 3, 4, 5 server APIs)
- Tasks 7–11: UI phases (depend on Task 6 API)
- Task 12: Integration tests + seed (depends on all)
- Task 13: Documentation

**Recommendation:** Subagent-driven development. Tasks 1–5 are server-side and can be implemented sequentially with independent reviews. Tasks 6–11 are client-side and depend on server APIs being stable. Task 12 is the final verification gate.

A shipped mistake in the detection engine or status validation would cause data integrity issues; independent review per task catches these early.

Does the plan capture what you want, and which approach should we use?