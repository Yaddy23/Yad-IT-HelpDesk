# ITSM Platform — Design Document

Date: 2026-10-21
Status: Draft for approval

## 1. Intent and Why

Build a complete, production-oriented **IT Help Desk & IT Service Management platform**
per the master prompt in this repository's brief. It must run the real day-to-day IT
support lifecycle of an organization: incidents, service requests, SLAs, assets,
problems, changes, approvals, knowledge, notifications, automation, and reports —
all integrated through shared records and consistent business rules.

**The intended audience for the deployment**: the owner will deploy it on Render and
demonstrate it (it lives in a PORTFOLIO folder). This means the demo surface
(dashboards, polish, realistic seeded data) matters, but the spec's hard rule stands:
no fake metrics, no simulated operations, no frontend-only permission checks.

## 2. Goals / Non-goals / Anti-goals

**Goals**
- End-to-end working ITSM workflows (not disconnected CRUD pages).
- Deployable on Render with a MongoDB Atlas cluster and Render Key Value (Redis).
- Docker-ready (Dockerfile + docker-compose kept valid even though the dev machine
  has no Docker installed).
- Real SLA business-time math, real approval engine, real RBAC on the backend.
- OpenAPI documentation, automated tests, seed scripts with clearly-marked demo data.

**Non-goals**
- Actual third-party integrations (Entra ID, LDAP, M365, monitoring) — only the
  integration *interface* and documentation; never claim an unimplemented integration.
- Outbound email by default — Nodemailer SMTP transport is implemented and
  configurable; without credentials the app runs in clearly-labeled console/dev mode.
- Semantic/AI knowledge search — tag + text matching only.

**Anti-goals (failure even if it "works")**
- Internal work notes reachable by requesters through any API path.
- SLAs computed by subtracting calendar timestamps when a business calendar applies.
- Hardcoded dashboard numbers or placeholder charts.
- Approval-less fulfillment of approval-required requests.

## 3. Constraints (decided by the owner)

| Decision | Value |
|---|---|
| Hosting | Render (blueprint `render.yaml`) |
| Database | Free MongoDB Atlas cluster, via `MONGODB_URI` env var |
| Redis / jobs | Free Render Key Value instance, via `REDIS_URL` env var |
| Docker | Dockerfile + docker-compose.yml (app + mongo + redis) kept valid; not used on the dev machine |
| Dev machine | Windows 11, Node 24, no Docker — local dev connects to the same Atlas/Key Value instances using **separate dev resources** (`itsm_dev` database, separate Redis key prefixes) |
| Commits | Ask before every commit/push; no co-author lines |
| Planning artifact | `taskplan.md` at repo root |
| Git remote | `origin` → https://github.com/Yaddy23/Yad-IT-HelpDesk.git |
| UI design | All UI design work goes through the `ui-ux-pro-max:ui-ux-pro-max` skill (owner instruction) |
| File storage | GridFS inside the MongoDB Atlas cluster (only free option under these constraints); 10MB per-file upload cap; documented 512MB free-cluster ceiling |
| Account provisioning | Admin-created accounts only — **no self-registration** (public demo URL); demo flows use clearly-labeled seeded accounts |
| Approvers | Users/employees carry an explicit `manager` field; approval rules resolve approvers by: specific user, role/assignment group, requester's manager, or department manager |
| Render free-tier spin-down | **Accepted by owner** — idle instances sleep (~15 min), cold starts 30–60s, SLA sweeps/jobs pause while asleep and catch up on wake. Documented as a known limitation; no keep-alive pinger |

## 4. Architecture

### 4.1 Topology

```
                    ┌────────────────────────────── Render ─────────────────────────────┐
 Browser ──HTTPS──▶ │  Web service (Dockerfile, Node 24):                               │
 (React SPA)        │   Express API  ──┬── REST /api/v1 (versioned routes)              │
                    │                  ├── Socket.IO (live updates)                     │
                    │                  └── serves built React SPA (single origin)       │
                    │                                                                   │
                    │   BullMQ worker: runs IN-PROCESS by default                       │
                    │   (WORKER_IN_PROCESS=true) so the free tier needs only            │
                    │   one service; `WORKER_SEPARATE=true` + a render.yaml worker      │
                    │   service is supported for paid deployment                        │
                    └──────────────┬──────────────────────────┬────────────────────────┘
                                   │ Mongoose                 │ ioredis (BullMQ)
                                   ▼                          ▼
                        MongoDB Atlas cluster        Render Key Value (Redis)
                        (dbs: itsm_dev / itsm_prod)  (BullMQ queues, rate-limit store)
```

Key points:
- **One web service** serves both the API and the built SPA — no CORS, one free
  instance, one deploy. The client is built (`vite build`) into `client/dist` and
  served statically with an SPA fallback.
- **Socket.IO** rides on the same HTTP server: ticket events, notifications,
  SLA warnings, queue updates.
- **Background jobs** via BullMQ: SLA deadline checks and escalations (repeatable
  jobs + delayed jobs), email queue, reminders (warranty/maintenance/approvals),
  scheduled reports, cleanup/archival. Render Cron jobs are paid, so all scheduling
  runs through BullMQ repeatable jobs. Every delayed job **rechecks record state**
  before acting (idempotency keys on notifications, escalations, stock movements).

### 4.2 Monorepo layout

```
IT_HelpDesk/
├─ client/                  React 18 + TS + Vite + Tailwind + shadcn/ui + TanStack Query
│  └─ src/
│     ├─ app/               router, providers, guards (role-based route access)
│     ├─ features/          per-module: tickets, assets, changes, problems, catalog,
│     │                     approvals, kb, reports, admin, automation, dashboard…
│     ├─ components/ui/     shadcn components
│     ├─ components/layout/ sidebar, topbar, global search
│     └─ lib/               api client (axios + TanStack Query hooks), zod schemas, utils
├─ server/                  Express + TS
│  └─ src/
│     ├─ modules/<domain>/  routes → controllers → services → validators (zod)
│     ├─ models/            Mongoose schemas + indexes (one file per collection)
│     ├─ core/              auth, rbac, audit, errors, rate-limit, express ctx
│     ├─ sla/               business calendar engine, SLA instance engine, escalations
│     ├─ approvals/         reusable approval engine
│     ├─ automation/        rules engine + execution history
│     ├─ jobs/              BullMQ queues, workers, repeatable schedules
│     ├─ integrations/      email (Nodemailer), webhook, generic integration interface
│     ├─ search/            global search with record-level authorization
│     └─ docs/              OpenAPI (swagger-jsdoc + swagger-ui)
├─ docker-compose.yml       app + mongo + redis for a Docker-capable machine
├─ Dockerfile               multi-stage: build client + server → single runtime image
├─ render.yaml              blueprint: web service (+ optional worker), env vars
├─ taskplan.md              phase-by-phase build plan with acceptance criteria
└─ .env.example             placeholders only
```

Business logic lives in services; routes/controllers only orchestrate; React
components never encode permissions or business rules.

### 4.3 Module dependency list (server)

`core/` (config, db, auth, rbac, audit, errors) ← everything.
`models/` ← `modules/*` (domain services) ← `modules/*/routes`.
`sla/` ← ticket module + jobs. `approvals/` ← service requests + changes + assets/licenses.
`automation/` ← event bus (in-process, typed events emitted by services) → actions
(assign, notify, escalate, note, webhook, approval, field update).
`jobs/` ← sla, notifications, reminders, automation schedules, cleanup.
No module imports another module's routes; cross-module work goes through services
and the event bus only (prevents cycles, keeps automation auditable).

## 5. RBAC and Security

Roles: `super_admin`, `it_admin`, `it_manager`, `it_technician`, `employee`, `approver`
(multi-role users allowed; permissions are the union). A **permission catalog**
(`permission:action` strings, e.g. `tickets:assign`, `changes:approve`, `admin:settings`)
is enforced by backend middleware **and** by record-level scoping inside services:

- employees see only their own tickets/requests/assigned assets;
- technicians see tickets in their authorized groups + their own assignments;
- internal work notes, restricted attachments, audit logs are permission-gated at the
  query level (never just hidden in the UI).

Role–permission matrix (summary; full catalog lives in `core/rbac`):

| Capability | super | it_admin | it_manager | tech | employee | approver |
|---|---|---|---|---|---|---|
| Manage users/roles/settings | ✅ | — | — | — | — | — |
| Configure SLAs, queues, catalog, automation | ✅ | ✅ | — | — | — | — |
| Create/edit tickets | ✅ | ✅ | ✅ | ✅ | own | — |
| Assign tickets | ✅ | ✅ | team | queue-limited | — | — |
| Resolve/close | ✅ | ✅ | ✅ | assigned | — | — |
| View internal work notes | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Problems / changes | ✅ | ✅ | ✅ | edit-assigned | ❌ | — |
| Approve requests/changes | ✅ | ✅ | policy | ❌ | ❌ | ✅ |
| All assets/lifecycle | ✅ | ✅ | view | assigned-work | own | — |
| Reports | all | operational | team perf | personal | own | approval queue |
| Audit logs | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

Separation of duties: requesters can never approve their own requests/changes.
Security controls per spec §24: bcrypt, session tokens with expiry/revocation,
rate limiting (Redis store), zod input validation, Mongo query sanitization, XSS-safe
rendering, security headers (helmet), restricted uploads (type/size allowlist) with
authorized downloads, audit trail of every security-sensitive action, secrets only via
env, logs exclude secrets. Compliance is documented, not claimed.

**First-admin bootstrap**: with zero users, `POST /api/v1/auth/bootstrap` requires
`SETUP_TOKEN` (env, 32+ random chars) and creates the first super admin; it then
permanently locks. Seed scripts create *demo* users clearly labeled as such.

## 6. Data Model Overview (relationships)

~50 collections per spec §25; the load-bearing relationships:

- **tickets** → requester(user), affectedEmployee(employee), group, assignee(user),
  assets[], problem?, parentIncident?, duplicates[]; one **slaInstances** doc per
  active policy (first-response, resolution, fulfillment) holding start/target/
  elapsed/pauseIntervals/breachStatus. Comments, activities, attachments,
  assignments, workLogs, surveys are separate collections keyed by ticketId.
- **serviceRequests** → catalogItem (defines dynamic form fields), items[],
  approvalRequests. **catalogItems** own their zod-validated form schema (JSON), so
  new catalog items need no new pages.
- **problems** → incidents[], knownError?, knowledgeArticles[].
- **changes** → riskAssessment, approvers via approvalRequests, relatedIncidents/
  Problems, maintenanceWindow conflicts, PIR record.
- **assets** → custodian(employee), location, department, licenses[];
  **assetAssignments** (append-only custody history), **assetMaintenanceRecords**
  (+ maintenanceSchedules), **softwareLicenses** → licenseAssignments (seat-counted),
  **inventoryItems** → stockMovements (append-only; negative stock blocked), 
  **assetAuditSessions** → assetAuditItems.
- **approvalRequests** → decisions[] (append-only, deduped), delegation, deadlines;
  used by requests, changes, asset/software purchases.
- **automationRules** → automationRuns → automationNodeRuns (full execution history).
- **notifications**, **notificationPreferences**, **auditLogs**, **systemSettings**
  (priority matrix, SLA pause states, reopen windows, automation limits), 
  **businessCalendars** (work hours, holidays, tz), **integrations** (status/errors).

All operational records timestamped; soft-delete only where meaningful; indexes on
number fields, statuses, SLA deadlines, foreign keys; activity/audit collections get
documented retention + archival jobs. Optimistic concurrency (`__v` / version keys)
on ticket state transitions.

## 7. SLA Engine (the hardest part)

- **Business-time calculation**: a `businessTime` utility walks business calendars
  (per-day work windows, timezone, holiday list) — never naive timestamp subtraction.
  Default calendar seeded; admins configure hours/holidays per department/location.
- **SLA instances** are materialized documents (per ticket × policy) recording start,
  target, elapsed business ms, remaining, pause intervals (states like
  Pending Employee / Pending Vendor pause *resolution* SLA per policy config),
  completion, breach status. Priority/category changes recompute the target and log
  the SLA history entry.
- **Warning + breach**: a repeatable BullMQ sweep (every minute) plus delayed jobs at
  exact thresholds recheck live state before firing; escalation chains (steps,
  targets, actions) run once per threshold (idempotency keys), fully auditable.
- Indicator states: within / approaching / breached / paused / met / missed.

## 8. Approval Engine

Single reusable engine: request docs carry an `approvalRequest` ref. Rules (configured
by admins per context — request type, change type/risk, cost thresholds) instantiate
approval steps: single / all / any / sequential, with delegations, deadlines,
reminders, rejection reasons, request-info loops, cancellation, full history.
Deduped decisions (one per step per approver); SoD check blocks self-approval.
Service requests physically cannot move to fulfillment until required steps are
satisfied (enforced in the service layer).

## 9. UI/UX (per spec §28, via ui-ux-pro-max design skill at build time)

Collapsible sidebar + role-based nav, topbar with global search, role-specific
dashboards (employee/tech/manager/admin), TanStack Query data tables (sort, filter,
paginate, saved views, column config), ticket detail page with summary header, SLA
chips, tabs (activity timeline, comments vs work notes, linked records, work logs,
approvals), Recharts dashboards with drill-down, dark/light theme, toasts, skeletons,
empty states, responsive, keyboard-accessible. Design system tokens established in
Phase 1 with the ui-ux-pro-max skill and reused everywhere.

## 10. Testing & Delivery

- **Vitest + RTL** for client units (priority calc, SLA display logic, form validation).
- **Supertest** for API integration tests — the 25 acceptance workflows of spec §29
  (note-invisibility to requesters, approval-gating, negative stock, license seats,
  idempotent retries, permission-respecting search, audit trail) map to test files.
- **Playwright** e2e for the golden paths (employee files incident → tech resolves →
  requester confirms; request with approval; change approval gate).
- Delivery: OpenAPI at `/api/docs`, README (install, first-admin bootstrap, Render
  deploy, Docker), backup/restore doc (Atlas + documented limits), `.env.example`,
  seed script (`npm run seed` — demo data explicitly labeled), implemented-vs-future
  integrations list, limitations list.

## 11. Build Order (mirrors taskplan.md)

1. **Foundation** — monorepo scaffold, config, Mongo connect, auth+bootstrap, RBAC,
   users/departments/locations/groups, audit log, client shell + design tokens + auth
   flows. *Verified by: login/RBAC tests, audit trail written.*
2. **Core Service Desk** — tickets/incidents, queues, assignment, comments/work notes,
   attachments, timeline, employee portal. *Verified by: acceptance tests 1–4, 20.*
3. **SLA & Communication** — calendars, SLA engine, escalations, notifications,
   email interface, BullMQ infra. *Verified by: tests 5–8, 22.*
4. **Asset Management** — assets, assignments, maintenance, warranty, inventory,
   licenses, audits. *Verified by: tests 15–19.*
5. **Service Management** — catalog, requests, approval engine, knowledge base,
   problems, changes, major incidents. *Verified by: tests 8–14.*
6. **Automation & Reporting** — rules engine + history, reports/analytics, CSAT,
   exports, scheduled tasks. *Verified by: tests 21, 23.*
7. **Production Readiness** — security review, e2e suite, Docker/render.yaml polish,
   OpenAPI, docs, backup/restore, limitations list.

Each phase ends with: tests green → review → **ask user to commit & push**.
