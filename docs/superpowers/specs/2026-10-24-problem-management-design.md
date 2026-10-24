# Problem Management — Design Document

**Date:** 2026-10-24 · **Status:** Draft for review
**Project:** ITSM Platform (Phase 5 — Service Management)
**Stack:** React 18 + Vite + Tailwind v4 + TanStack Query · Express + Prisma + Supabase Postgres · BullMQ (Redis) for background jobs

---

## 1. Intent and Why

**Pain point:** Service desk technicians resolve the same symptoms repeatedly (e.g., 15 employees report network disconnections → 15 incident tickets → each restored individually → root cause never tracked → problem recurs). Incident Management restores service; Problem Management prevents recurrence.

**Goal:** A centralized way to group related incidents, investigate root causes, track workarounds/known errors, link to Change Management for permanent fixes, and verify that resolutions actually stop recurrences.

**Success looks like:** A technician notices a pattern, creates or links a problem, investigates with structured RCA, documents workarounds, publishes known errors, links a change request, and closes the problem only after verifying the fix works — all while maintaining traceability to the original incident tickets.

---

## 2. Goals / Non-Goals / Anti-Goals

### Goals
- Problem records linked to multiple incident tickets (many-to-many via `problem_incidents`)
- Dual-mode detection: background BullMQ analysis + on-demand "Find related" manual search
- Structured RCA: 5 Whys + Fishbone templates + free-text investigation notes + evidence attachments
- Known Error library: separate table, lifecycle (Draft → Under Review → Published → Retired), visibility controls, KB integration
- Change integration: event-driven status awareness, no tight coupling, fix verification required before "Resolved"
- Role-based permissions: problem owners, technicians, approvers, administrators
- Immutable audit trail for lifecycle transitions
- Pagination/filtering for large volumes
- Feature flags / graceful fallback when Redis/BullMQ unavailable

### Non-Goals
- AI/ML-based anomaly detection (phase 6+)
- Automatic problem creation without human approval (except explicit automation rules)
- Tight lifecycle coupling with Change Management (e.g., auto-close problem on change implemented)
- Customer/employee self-service problem creation (IT-only for creation; known errors can be employee-visible)

### Anti-Goals (failure even if "works")
- Duplicate problem records for the same underlying issue
- Problem marked "Resolved" without verified fix or documented exception
- Known Errors published without approval
- Workarounds exposed to employees without visibility controls
- Background detection consuming resources when Redis unavailable (must gracefully degrade)

---

## 3. Constraints (Inherited from Platform)

| Decision | Value |
|---|---|
| Database | Supabase Postgres (relational) via Prisma — `DATABASE_URL` |
| Redis / Jobs | Render Key Value (Redis) via `REDIS_URL`; BullMQ for queues |
| File Storage | Supabase Storage private bucket (service key server-side only) |
| Auth | JWT sessions, refresh rotation, RBAC middleware |
| UI | Design tokens via `ui-ux-pro-max`; dark/light; responsive; keyboard-accessible |
| Tests | Vitest (API/unit) + Playwright (e2e); test schema on Supabase |
| Commits | Ask before commit/push; no co-author lines |

---

## 4. Data Model (Prisma)

### 4.1 Core Tables

```prisma
enum ProblemStatus {
  IDENTIFIED
  INVESTIGATION
  ROOT_CAUSE_KNOWN
  WORKAROUND_DOCUMENTED
  PENDING_CHANGE
  RESOLVED
  CLOSED
}

enum ProblemPriority {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum RCAType {
  FIVE_WHYS
  FISHBONE
  NONE
}

enum KnownErrorStatus {
  DRAFT
  UNDER_REVIEW
  PUBLISHED
  RETIRED
}

enum KnownErrorVisibility {
  IT_ONLY
  EMPLOYEE_SELF_SERVICE
}
```

### 4.2 Problem

```prisma
model Problem {
  id               String        @id @default(cuid())
  number           String        @unique // e.g., PRB-2026-00001
  title            String
  description      String        @db.Text
  status           ProblemStatus @default(IDENTIFIED)
  priority         ProblemPriority @default(MEDIUM)
  rcaType          RCAType       @default(NONE)
  
  // Ownership
  ownerId          String
  owner            User          @relation(fields: [ownerId], references: [id])
  
  // Impact
  affectedServices String[]
  affectedAssets   String[]
  affectedCIs      String[]
  businessImpact   String        @db.Text // description of impact
  
  // Root Cause Analysis
  rootCause        String?       @db.Text
  resolutionSummary String?      @db.Text
  rcaNotes         String?       @db.Text // free-text investigation notes
  fiveWhys         Json?         // structured 5 Whys data
  fishbone         Json?         // structured Fishbone data
  confirmedRootCause Boolean     @default(false)
  
  // Workaround / Known Error link
  workaround       String?       @db.Text
  knownErrorId     String?
  knownError       KnownError?   @relation(fields: [knownErrorId], references: [id])
  
  // Change integration
  changeRequestIds String[]      // array of change request IDs
  
  // Detection
  detectionSource  String?       // "AUTO" | "MANUAL" | "AUTOMATION_RULE"
  autoDetectionScore Float?      // similarity score from background job
  
  // Timestamps
  identifiedAt     DateTime      @default(now())
  investigationStartedAt DateTime?
  rootCauseIdentifiedAt DateTime?
  workaroundDocumentedAt DateTime?
  changeInitiatedAt DateTime?
  resolvedAt       DateTime?
  closedAt         DateTime?
  reviewDueAt      DateTime?
  
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  deletedAt        DateTime?
  
  // Relations
  incidents        ProblemIncident[]
  auditLogs        AuditLog[]
  
  @@index([status])
  @@index([ownerId])
  @@index([number])
  @@index([identifiedAt])
  @@index([affectedServices, affectedAssets])
}
```

### 4.3 ProblemIncident (Link Table)

```prisma
model ProblemIncident {
  id           String   @id @default(cuid())
  problemId    String
  problem      Problem  @relation(fields: [problemId], references: [id], onDelete: Cascade)
  incidentId   String
  incident     Ticket   @relation(fields: [incidentId], references: [id], onDelete: Cascade)
  linkedAt     DateTime @default(now())
  linkedById   String
  linkedBy     User     @relation(fields: [linkedById], references: [id])
  note         String?  // why this incident was linked
  
  @@unique([problemId, incidentId])
  @@index([incidentId])
}
```

### 4.4 KnownError

```prisma
model KnownError {
  id               String              @id @default(cuid())
  number           String              @unique // e.g., KE-2026-00001
  title            String
  problemId        String
  problem          Problem             @relation(fields: [problemId], references: [id])
  
  // Content
  rootCause        String              @db.Text
  symptoms         String              @db.Text
  workaround       String              @db.Text
  resolutionNotes  String?             @db.Text
  
  // Scope
  affectedServices String[]
  affectedAssets   String[]
  affectedCIs      String[]
  
  // Lifecycle
  status           KnownErrorStatus    @default(DRAFT)
  visibility       KnownErrorVisibility @default(IT_ONLY)
  
  // Ownership / Approval
  ownerId          String
  owner            User                @relation(fields: [ownerId], references: [id])
  approvedById     String?
  approvedBy       User?               @relation(fields: [approvedById], references: [id])
  approvedAt       DateTime?
  
  // Review
  reviewDueAt      DateTime?
  lastReviewedAt   DateTime?
  
  // KB Integration
  publishedArticleId String?
  publishedArticle   KnowledgeArticle? @relation(fields: [publishedArticleId], references: [id])
  
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt
  deletedAt        DateTime?
  
  @@index([status])
  @@index([visibility])
  @@index([problemId])
  @@index([ownerId])
}
```

### 4.5 ProblemRCA (Structured RCA Records)

```prisma
model ProblemRCA {
  id           String   @id @default(cuid())
  problemId    String   @unique
  problem      Problem  @relation(fields: [problemId], references: [id], onDelete: Cascade)
  
  // 5 Whys
  fiveWhys     Json?    // { steps: [{ why: string, answer: string }], rootCause: string }
  
  // Fishbone
  fishbone     Json?    // { categories: { People: string[], Process: string[], Technology: string[], Equipment: string[], Environment: string[], Other: string[] }, rootCause: string }
  
  // Evidence
  attachments  String[] // array of attachment IDs
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  @@index([problemId])
}
```

### 4.6 Audit Log (Append-only)

```prisma
model ProblemAuditLog {
  id            String   @id @default(cuid())
  problemId     String
  problem       Problem  @relation(fields: [problemId], references: [id], onDelete: Cascade)
  action        String   // e.g., "STATUS_CHANGED", "INCIDENT_LINKED", "RCA_UPDATED", "CHANGE_LINKED", "KNOWN_ERROR_CREATED"
  oldValue      Json?
  newValue      Json?
  actorId       String
  actor         User     @relation(fields: [actorId], references: [id])
  createdAt     DateTime @default(now())
  
  @@index([problemId])
  @@index([createdAt])
}
```

---

## 5. API Design (REST /api/v1)

### 5.1 Problem Endpoints

| Method | Path | Description | Permissions |
|---|---|---|---|
| GET | /problems | List problems (filter, sort, paginate) | `problems:read` |
| POST | /problems | Create problem | `problems:create` |
| GET | /problems/:id | Get problem detail (with incidents, RCA, linked changes) | `problems:read` |
| PATCH | /problems/:id | Update problem (title, description, priority, owner, etc.) | `problems:update` |
| POST | /problems/:id/incidents | Link incidents to problem | `problems:update` |
| DELETE | /problems/:id/incidents/:incidentId | Unlink incident | `problems:update` |
| POST | /problems/:id/status | Transition status (with validation) | `problems:update` |
| POST | /problems/:id/rca | Update RCA (5 Whys / Fishbone / notes) | `problems:update` |
| POST | /problems/:id/workaround | Set workaround | `problems:update` |
| POST | /problems/:id/changes | Link change request | `problems:update` |
| DELETE | /problems/:id/changes/:changeId | Unlink change request | `problems:update` |
| GET | /problems/:id/audit | Get audit history | `problems:read` |

### 5.2 Detection Endpoints

| Method | Path | Description | Permissions |
|---|---|---|---|
| GET | /problems/detect | Manual "Find related" — search incidents by criteria | `problems:read` |
| POST | /problems/from-incidents | Create problem from selected incidents | `problems:create` |
| GET | /problems/:id/similar | Get similar problems (for duplicate prevention) | `problems:read` |

### 5.3 Known Error Endpoints

| Method | Path | Description | Permissions |
|---|---|---|---|
| GET | /known-errors | List known errors (filter by status, visibility) | `known_errors:read` |
| POST | /known-errors | Create known error from problem | `known_errors:create` |
| GET | /known-errors/:id | Get known error detail | `known_errors:read` |
| PATCH | /known-errors/:id | Update known error | `known_errors:update` |
| POST | /known-errors/:id/status | Transition status (with approval) | `known_errors:approve` |
| POST | /known-errors/:id/publish-kb | Publish workaround as KB article | `known_errors:publish` |
| GET | /known-errors/search | Search workarounds (employee self-service) | `known_errors:read` |

### 5.4 Change Integration (Event Consumption)

Problem service listens to Change events:
- `change.approved` → notify problem owner
- `change.implemented` → notify problem owner; suggest fix verification
- `change.rejected` → notify problem owner
- `change.rolled_back` → notify problem owner; offer to reopen problem

---

## 6. Background Detection (BullMQ)

### 6.1 Queue: `problem-detection`

**Repeatable job:** Runs every 15 minutes (configurable via system setting).

**Logic:**
1. Fetch new incidents since last run (status = RESOLVED/CLOSED, created in window)
2. For each incident, compute similarity against existing open problems:
   - Exact match: same `affectedService`, `category`, `assetId`/`ciId`, error code
   - Fuzzy match: symptom text similarity (trigram/pg_trgm or application-level scoring)
   - Time pattern: incidents within rolling window (e.g., 3+ same category in 24h)
3. Score each candidate (0–100)
4. If score ≥ threshold (configurable, default 75):
   - If auto-creation enabled via automation rule → create problem, link incidents
   - Else → create `DetectionSuggestion` record for technician review

### 6.2 DetectionSuggestion (Transient)

```prisma
model DetectionSuggestion {
  id            String   @id @default(cuid())
  incidentIds   String[]
  problemId     String?  // null = new problem suggested
  score         Float
  matchReasons  String[] // ["same_service", "same_asset", "symptom_similarity"]
  status        String   @default(PENDING) // PENDING | ACCEPTED | REJECTED | EXPIRED
  reviewedById  String?
  reviewedAt    DateTime?
  createdAt     DateTime @default(now())
  expiresAt     DateTime
  
  @@index([status])
  @@index([expiresAt])
}
```

### 6.3 Modular Detection Logic

Detection logic lives in `server/src/problems/detection/`:
- `detectionEngine.ts` — pure functions, no BullMQ dependency
- `scoring.ts` — similarity algorithms
- `criteria.ts` — match criteria configuration

Can be invoked via:
- BullMQ worker (when Redis available)
- On-demand API call (`POST /problems/detect` for manual trigger)
- Scheduled cron (future Render Cron job alternative)

---

## 7. Status Transitions & Validation

```
IDENTIFIED
  → INVESTIGATION (owner assigned, investigationStartedAt set)
  → ROOT_CAUSE_KNOWN (rootCause + confirmedRootCause = true required)
  → WORKAROUND_DOCUMENTED (workaround required)
  → PENDING_CHANGE (at least one changeRequestId linked)
  → RESOLVED (resolutionSummary + verifiedFix = true OR exception documented)
  → CLOSED (final closure, no further action)

Any status → CLOSED (with closure reason)
RESOLVED → INVESTIGATION (reopen, e.g., change rolled back)
```

**Validation rules:**
- `ROOT_CAUSE_KNOWN`: requires `rootCause` non-empty + `confirmedRootCause = true`
- `WORKAROUND_DOCUMENTED`: requires `workaround` non-empty
- `PENDING_CHANGE`: requires at least one `changeRequestId`
- `RESOLVED`: requires `resolutionSummary` non-empty + (`verifiedFix = true` OR `exceptionReason` documented)
- Exception for unknown root cause: `exceptionReason` required, requires `it_manager` or `problem_manager` role

---

## 8. Permissions (RBAC)

| Permission | Roles |
|---|---|
| `problems:read` | all IT roles + approver |
| `problems:create` | it_technician, it_manager, it_admin, super_admin |
| `problems:update` | owner, it_manager, it_admin, super_admin |
| `problems:transition` | owner, it_manager, it_admin, super_admin |
| `problems:link_incidents` | it_technician, it_manager, it_admin, super_admin |
| `problems:manage_rca` | owner, it_manager, it_admin, super_admin |
| `known_errors:read` | all IT roles |
| `known_errors:create` | it_manager, it_admin, super_admin |
| `known_errors:update` | owner, it_manager, it_admin, super_admin |
| `known_errors:approve` | it_manager, it_admin, super_admin |
| `known_errors:publish` | it_manager, it_admin, super_admin |

Record-level scoping: Technicians see problems they own or are linked to via incidents they can access. Managers/Admins see all.

---

## 9. UI/UX (via ui-ux-pro-max)

### 9.1 Pages (Phase Order)

**Phase 1 — Problem List & Detail**
- `/problems` — List with filters (status, priority, owner, affected service, date range), pagination, "New Problem" button
- `/problems/:id` — Detail: header (number, title, status, priority, owner), tabs:
  - Overview: description, business impact, affected services/assets/CIs, timeline
  - Incidents: linked incidents table (with link/unlink actions), "Find related" button
  - Investigation: RCA method selector (5 Whys / Fishbone / Notes), structured forms, evidence upload, validation
  - Workaround: workaround editor, "Create Known Error" action
  - Changes: linked change requests with status badges, "Link Change" action
  - Audit: immutable history

**Phase 2 — Detection**
- Detection suggestions panel in problem list (sidebar or toast)
- "Find Related" modal on incident detail / problem create
- Background job status/configuration in admin settings

**Phase 3 — Known Error Library**
- `/known-errors` — List with filters (status, visibility, service), search
- `/known-errors/:id` — Detail with approval workflow
- Employee self-service view (read-only, filtered by visibility)

**Phase 4 — Change Integration**
- Change linking UI in problem detail
- Change event notifications in problem detail / inbox
- Fix verification wizard before "Resolved"

**Phase 5 — Dashboards**
- `/problems/dashboard` — Recurring incident trends, major causes (Pareto), problem aging, overdue investigations, known-error usage, fix effectiveness

### 9.2 Design Standards
- Tailwind v4 semantic tokens (dark/light)
- TanStack Query for server state
- Skeleton loading, empty states, error toasts
- Keyboard navigation, ARIA labels
- 44×44px touch targets
- Responsive: mobile-first, breakpoint at 640/1024px

---

## 10. Testing Strategy

### 10.1 Unit (Vitest)
- Detection scoring algorithms (exact match, fuzzy, time pattern)
- Status transition validation (all paths, exceptions)
- Duplicate prevention logic
- RCA form validation (5 Whys sequence, Fishbone categories)

### 10.2 Integration (Supertest)
- CRUD for problems, known errors
- Incident linking/unlinking
- Status transitions with validation
- Detection suggestion create/accept/reject
- Change event consumption (mock events)
- Known error approval/publication
- RBAC enforcement (403 for unauthorized)

### 10.3 E2E (Playwright)
- Create problem → link incidents → investigate → document workaround → link change → verify fix → resolve
- Manual "Find related" flow from incident detail
- Known error creation → approval → KB publish → employee search
- Duplicate detection prevention
- Change rollback → problem reopen notification

---

## 11. Configuration & Feature Flags

| Setting | Default | Description |
|---|---|---|
| `PROBLEM_DETECTION_ENABLED` | true | Master toggle for background detection |
| `PROBLEM_DETECTION_INTERVAL_MIN` | 15 | BullMQ repeatable job interval |
| `PROBLEM_DETECTION_THRESHOLD` | 75 | Similarity score threshold (0–100) |
| `PROBLEM_AUTO_CREATE_ENABLED` | false | Allow automation rules to auto-create problems |
| `PROBLEM_REDIS_FALLBACK` | true | Enable on-demand API detection when Redis unavailable |
| `KNOWN_ERROR_REVIEW_DAYS` | 90 | Default review period for published known errors |

---

## 12. Open Questions for Builder

1. **Error code field** — Does `Ticket` have a structured `errorCode` field, or should detection use free-text symptom matching only?
2. **CI/CMDB integration** — Are `affectedAssets`/`affectedCIs` free-text arrays or FKs to an Asset/CMDB module?
3. **Notification channels** — Use existing in-app notification inbox + email queue, or add problem-specific channels?
4. **5 Whys step count** — Fixed 5 steps, or configurable (3–7)?
5. **Fishbone categories** — Use the 6 standard categories (People, Process, Technology, Equipment, Environment, Other) as hardcoded, or make them configurable per org?
6. **Known Error → KB publish** — Should this create a new KB article or update an existing one? What visibility does the KB article get?

---

## 13. Acceptance Criteria (Mapped to Master Brief §29 Tests 8–14)

| Test | Description |
|---|---|
| 8 | Problem creation from incident cluster; incidents linked; owner assigned |
| 9 | RCA documented (5 Whys or Fishbone); validation prevents premature "Resolved" |
| 10 | Workaround documented; Known Error created; approval workflow enforced |
| 11 | Change Request linked; problem stays "In Progress" until fix verified |
| 12 | Change rollback → problem owner notified; problem returns to investigation |
| 13 | Background detection suggests matches; technician accepts/rejects; no duplicates |
| 14 | Dashboard shows recurring trends, aging, overdue, fix effectiveness |

---

## 14. Implementation Sequence

1. **Prisma schema + migration** — Problems, ProblemIncident, KnownError, ProblemRCA, ProblemAuditLog, DetectionSuggestion
2. **Server core** — Service layer, validators, routes, RBAC, audit events
3. **Detection engine** — Pure functions + BullMQ worker + API endpoint
4. **Change event consumer** — Listen to change events, update problem state, notify
5. **Client API** — `problemApi.ts` with types and queries/mutations
6. **Phase 1 UI** — Problem list, detail (tabs), create/edit, incident linking, RCA forms
7. **Phase 2 UI** — Detection suggestions, "Find related" modal
8. **Phase 3 UI** — Known Error list/detail, approval, KB publish
9. **Phase 4 UI** — Change linking, fix verification
10. **Phase 5 UI** — Dashboard with charts (Recharts)
11. **Tests** — Unit, integration, e2e for all phases
12. **Seed data** — Demo problems, known errors for seeded incidents

---

## 15. What's Left to the Builder

- Exact Prisma field types (e.g., `Json` structure for 5 Whys/Fishbone)
- Similarity scoring algorithm details (pg_trgm vs application-level)
- BullMQ worker concurrency and error handling
- Notification template content
- Chart types and colors for dashboard (use `dataviz` skill)
- Exact permission checks in service layer (reuse existing RBAC patterns)
- Seed script data for demo problems

---

## 16. Additional Implementation Details

### 16.1 Number Generation

Problem and Known Error numbers follow the same pattern as tickets (`INC-2026-000001`):

- **Problem**: `PRB-YYYY-NNNNNN` (e.g., `PRB-2026-000001`)
- **Known Error**: `KE-YYYY-NNNNNN` (e.g., `KE-2026-000001`)

Implementation: `server/src/problems/numberGenerator.ts` — uses a dedicated counter row in `system_settings` or a sequence table, atomically incremented in a transaction with the create operation.

### 16.2 Attachment Handling (RCA Evidence)

- Stored in Supabase Storage private bucket: `problem-attachments/{problemId}/{uuid}.{ext}`
- Metadata in `ProblemRCA.attachments` as array of `{ id, filename, mimeType, size, uploadedAt, uploadedById }`
- Upload endpoint: `POST /api/v1/problems/:id/rca/attachments` (multipart/form-data)
- Download: `GET /api/v1/problems/:id/rca/attachments/:attachmentId` (mediated, audited)
- Max file size: 10MB (platform default)
- Allowed types: images, PDF, text, office documents

### 16.3 Socket.IO Real-Time Events

Problem service emits events on the existing Socket.IO server (`server/src/core/socket.ts`):

| Event | Payload | Room |
|---|---|---|
| `problem:created` | `{ problemId, number, title, ownerId }` | `role:it_manager`, `role:it_admin` |
| `problem:updated` | `{ problemId, changes }` | `problem:{problemId}` |
| `problem:status_changed` | `{ problemId, oldStatus, newStatus }` | `problem:{problemId}`, `user:{ownerId}` |
| `problem:incident_linked` | `{ problemId, incidentId, incidentNumber }` | `problem:{problemId}` |
| `problem:detection_suggestion` | `{ suggestionId, incidentIds, score }` | `role:it_technician`, `role:it_manager` |
| `known_error:published` | `{ knownErrorId, number, title }` | `role:employee` (for self-service visibility) |

Clients subscribe to `problem:{problemId}` room when viewing detail page.

### 16.4 API Response Format & Pagination

Follows existing platform conventions (`server/src/core/apiResponse.ts`):

```typescript
// List response
{
  data: ProblemSummary[],
  meta: { page: number, limit: number, total: number, pages: number }
}

// Single response
{ data: ProblemDetail }

// Error response
{ error: { code: string, message: string, details?: any } }
```

List endpoints accept standard query params: `page`, `limit`, `sort`, `order`, `filter[field]=value`, `search=term`.

### 16.5 Search/Filter Implementation

`GET /problems` supports:
- `filter[status]=INVESTIGATION,ROOT_CAUSE_KNOWN` (comma-separated OR)
- `filter[priority]=HIGH,CRITICAL`
- `filter[ownerId]=<uuid>`
- `filter[affectedService]=<serviceName>`
- `filter[identifiedAfter]=2026-01-01`
- `filter[identifiedBefore]=2026-12-31`
- `search=network` (searches title, description, rootCause, workaround)
- `sort=identifiedAt&order=desc`

Implemented via `server/src/problems/validators.ts` (zod schema) → service builds Prisma `where` clause.

### 16.6 Rate Limiting

Inherits platform rate limiter (`server/src/core/rateLimit.ts`):
- Authenticated: 200 req/15min per IP
- Problem create/update: 50 req/15min per user
- Detection endpoints: 30 req/15min per user

### 16.7 OpenAPI Documentation

All endpoints documented via `swagger-jsdoc` annotations in route files. Served at `/api/docs`.

### 16.8 Problem SLA Tracking (Optional Enhancement)

Not in current scope but designed for future:
- `Problem.slaTargetAt` — calculated from priority + business calendar
- `Problem.slaBreachedAt` — set when target missed
- Background job checks overdue problems, emits `problem:sla_breached` event
- Escalation to manager if problem in `INVESTIGATION` > 72h without progress

### 16.9 Bulk Operations (Phase 1+)

- `POST /problems/bulk-status` — transition multiple problems (managers only)
- `POST /problems/:id/incidents/bulk` — link multiple incidents at once
- `DELETE /problems/:id/incidents/bulk` — unlink multiple incidents

### 16.10 Migration Strategy

1. Create migration `20261024000000_problem_management` with all new models
2. Run `prisma migrate deploy` against `dev` schema
3. Seed demo data via `prisma db seed` (add to existing seed script)
4. Run `prisma migrate deploy` against `test` schema before CI
5. Run `prisma migrate deploy` against `prod` schema on Render deploy

### 16.11 Feature Flag Integration

Flags stored in `system_settings` (singleton row), cached in memory with 5-min TTL:

```typescript
// server/src/problems/config.ts
export const problemConfig = {
  detectionEnabled: () => getSetting('PROBLEM_DETECTION_ENABLED', true),
  detectionIntervalMin: () => getSetting('PROBLEM_DETECTION_INTERVAL_MIN', 15),
  detectionThreshold: () => getSetting('PROBLEM_DETECTION_THRESHOLD', 75),
  autoCreateEnabled: () => getSetting('PROBLEM_AUTO_CREATE_ENABLED', false),
  redisFallback: () => getSetting('PROBLEM_REDIS_FALLBACK', true),
  knownErrorReviewDays: () => getSetting('KNOWN_ERROR_REVIEW_DAYS', 90),
};
```

Admin UI for these settings in `/admin/settings` (existing page, add problem section).

---

*This design document argues from the master brief and the platform design (Rev 2). Once approved, the next step is an implementation plan via `superpowers:writing-plans`.*