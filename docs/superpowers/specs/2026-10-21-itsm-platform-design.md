# ITSM Platform — Design Document

Date: 2026-10-21 · Rev 2 (revised: MongoDB Atlas → **Supabase Postgres + Prisma**)
Status: Awaiting approval of Rev 2 changes

## 1. Intent and Why

Build a complete, production-oriented **IT Help Desk & IT Service Management platform**
per the master prompt (saved at `docs/MASTER_BRIEF.md`). It must run the real
day-to-day IT support lifecycle of an organization: incidents, service requests, SLAs,
assets, problems, changes, approvals, knowledge, notifications, automation, and
reports — all integrated through shared records and consistent business rules.

The owner will deploy it on Render and demonstrate it (PORTFOLIO project): the demo
surface matters, but the master prompt's hard rules stand — no fake metrics, no
simulated operations, no frontend-only permission checks.

**Rev 2 change (owner decision):** the database is now **Supabase Postgres** (free
tier) with a **fully relational schema**, replacing the MongoDB Atlas + Mongoose
design. Supabase is used **as managed Postgres only** — the Express API keeps owning
all data access, auth (JWT), and authorization (RBAC). Supabase Auth, RLS, Realtime
and Edge Functions are NOT used. Prisma is the ORM/query layer.

## 2. Goals / Non-goals / Anti-goals

**Goals**
- End-to-end working ITSM workflows (not disconnected CRUD pages).
- Deployable on Render: web service + Render Key Value (Redis) + Supabase Postgres.
- Docker-ready (Dockerfile + docker-compose kept valid; dev machine has no Docker).
- Real SLA business-time math, real approval engine, real backend RBAC.
- Relational integrity: FK constraints, transactions for multi-table invariants.
- OpenAPI docs, automated tests, seed scripts with clearly-marked demo data.

**Non-goals**
- Supabase Auth / RLS / Realtime / Edge Functions (owner chose Postgres-only usage).
- Actual third-party integrations (Entra ID, LDAP, M365, monitoring) — interface +
  docs only; never claim an unimplemented integration.
- Outbound email by default — Nodemailer SMTP implemented/configurable; without
  credentials the app runs in clearly-labeled console-dev mode.
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
| Database | **Supabase Postgres (free tier), relational, via Prisma — `DATABASE_URL` env var** |
| Redis / jobs | Free Render Key Value instance, via `REDIS_URL` env var |
| File storage | **Supabase Storage private bucket** (service key held server-side only; every download mediated by our API; 10MB per-file cap). Replaces the Rev-1 GridFS decision. |
| Docker | Dockerfile + docker-compose.yml (app + postgres + redis) kept valid; not used on the dev machine |
| Dev machine | Windows 11, Node 24, no Docker — local dev connects to Supabase Postgres + Render Key Value using a **dedicated `dev` schema**; integration tests use a dedicated `test` schema |
| Commits | Ask before every commit/push; no co-author lines |
| Planning artifact | `taskplan.md` at repo root |
| Git remote | `origin` → https://github.com/Yaddy23/Yad-IT-HelpDesk.git |
| UI design | All UI design work goes through the `ui-ux-pro-max:ui-ux-pro-max` skill (owner instruction) |
| Account provisioning | Admin-created accounts only — **no self-registration** (public demo URL); demo flows use clearly-labeled seeded accounts |
| Approvers | Employees carry an explicit `manager` self-FK; approval rules resolve approvers by: specific user, role/assignment group, requester's manager, or department manager |
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
                    │   one service; a separate worker service is supported             │
                    └──────────────┬──────────────────────────┬────────────────────────┘
                                   │ Prisma (pooled)          │ ioredis (BullMQ)
                                   ▼                          ▼
                    Supabase Postgres             Render Key Value (Redis)
                    (schemas: dev / test / prod)  (BullMQ queues, rate-limit store)
                                   │
                                   └── Supabase Storage (private bucket: attachments)
```

Key points:
- **One web service** serves both the API and the built SPA — no CORS, one free
  instance. Socket.IO rides on the same HTTP server.
- **Supabase connection**: long-lived Express server uses the direct connection
  (`DATABASE_URL`, port 5432) plus `DIRECT_URL` for `prisma migrate`. Supabase's
  PgBouncer transaction pooler (port 6543) is the documented fallback if connection
  limits become an issue.
- **Schemas instead of separate databases** (Supabase free tier is one cluster):
  `dev`, `test`, and `prod` live in one Postgres project, fully isolated by
  `search_path`. Prisma migrations run per schema.
- **Background jobs** via BullMQ: SLA sweeps/escalations (repeatable + delayed jobs),
  email queue, reminders, scheduled reports, cleanup/archival. Render Cron jobs are
  paid, so all scheduling runs through BullMQ repeatable jobs. Every delayed job
  **rechecks record state** before acting (idempotency keys on notifications,
  escalations, stock movements).

### 4.2 Monorepo layout

```
IT_HelpDesk/
├─ client/                  React 18 + TS + Vite + Tailwind + shadcn/ui + TanStack Query
│  └─ src/                  (app/ features/ components/ lib/ — unchanged from Rev 1)
├─ server/                  Express + TS
│  └─ src/
│     ├─ prisma/            schema.prisma (source of truth) + migrations/ + seed.ts
│     ├─ modules/<domain>/  routes → controllers → services → validators (zod)
│     ├─ core/              auth, rbac, audit, errors, rate-limit, config, logger
│     ├─ sla/               business calendar engine, SLA instance engine, escalations
│     ├─ approvals/         reusable approval engine
│     ├─ automation/        rules engine + execution history
│     ├─ jobs/              BullMQ queues, workers, repeatable schedules
│     ├─ integrations/      email (Nodemailer), webhook, generic integration interface
│     ├─ search/            global search with record-level authorization
│     └─ docs/              OpenAPI (swagger-jsdoc + swagger-ui)
├─ docker-compose.yml       app + postgres + redis for a Docker-capable machine
├─ Dockerfile               multi-stage: build client + server → single runtime image
├─ render.yaml              blueprint: web service (+ optional worker), env vars
├─ taskplan.md              phase-by-phase build plan with acceptance criteria
└─ .env.example             placeholders only
```

Business logic lives in services; routes/controllers orchestrate; React components
never encode permissions or business rules. Services access the database **only**
through Prisma (generated client) — no raw SQL scattered across modules; the rare
raw query (reporting aggregates) lives in `server/src/prisma/sql/` with comments.

### 4.3 Module dependency list (server)

Unchanged from Rev 1: `core/` ← everything; `modules/*` ← `core/` + Prisma;
`sla/` ← tickets + jobs; `approvals/` ← service requests + changes + purchases;
`automation/` ← typed in-process event bus → actions; `jobs/` ← sla, notifications,
reminders, cleanup. Cross-module work goes through services and the event bus only.

## 5. RBAC and Security

Unchanged from Rev 1 (backend-enforced permission catalog + record-level scoping in
services; super_admin/it_admin/it_manager/it_technician/employee/approver; employees
see only their own records; internal work notes never exposed at the query level;
SoD blocks self-approval; audit trail on every security-sensitive action). Roles are
stored in a `user_roles` join table (relational) with the same catalog.

Security controls: bcrypt (12 rounds), JWT access tokens + rotating refresh sessions
(reuse detection revokes the session family), rate limiting (Redis store, memory
fallback), zod validation everywhere, operator-injection guards, helmet headers,
restricted uploads with authorized downloads, secrets via env only, logs exclude
secrets. Compliance documented, not claimed.

**First-admin bootstrap** unchanged: `POST /api/v1/auth/bootstrap` requires
`SETUP_TOKEN`, works only while the users table is empty, then locks forever.

## 6. Data Model Overview (relational)

Prisma schema, PostgreSQL native. Highlights (full model list per master brief §25):

- **Identity/org**: `users` (+ `user_roles` join), `sessions` (refresh tokens, TTL
  via expiresAt sweep), `employees` (self-FK `managerId`, FK `departmentId`,
  `locationId`, unique `employeeId`), `departments`, `locations`, `vendors`,
  `assignment_groups` (+ `assignment_group_members` join with group role),
  `business_calendars` + `calendar_work_windows` + `calendar_holidays`.
- **Service desk**: `tickets` (unique human number `INC-2026-000001`, FKs requester/
  assignee/group/problem/change/parent, impact+urgency enums → priority, status
  enum, `version` column for optimistic concurrency) with child tables
  `ticket_comments` (public/internal flag), `ticket_attachments`, `ticket_activities`
  (append-only timeline), `ticket_assignments` (append-only ownership history),
  `work_logs`, `sla_instances` (per ticket × policy: start/target/elapsed/pause
  intervals/breach status), `satisfaction_surveys` (unique per ticket×policy).
- **Service mgmt**: `catalog_items` (form definition in `jsonb` — the one genuinely
  schemaless place), `service_requests` (+ `service_request_items`), `problems`,
  `problem_incidents` link table, `known_errors`, `changes`, `change_approvals`.
- **Approvals**: `approval_requests` + `approval_decisions` (append-only, unique
  (request, step, approver) — duplicates impossible at the DB level).
- **Assets**: `assets` (unique asset number, lifecycle status, FK custodian/location/
  department), `asset_assignments` (append-only custody, unique active-assignment
  partial index per individually-tracked asset), `asset_maintenance_records`,
  `maintenance_schedules`, `inventory_items`, `stock_movements` (append-only; stock
  level maintained transactionally — negative stock blocked in-transaction),
  `software_licenses`, `license_assignments` (seat counting via transaction +
  constraint check), `asset_audit_sessions` + `asset_audit_items`.
- **Knowledge**: `knowledge_articles` + `knowledge_revisions` (append-only versions).
- **Platform**: `notifications`, `notification_preferences`, `audit_logs` (append-only),
  `system_settings` (singleton row), `automation_rules` → `automation_runs` →
  `automation_node_runs`, `integrations` (status/error logs).

Relational rules: FK constraints with explicit RESTRICT/CASCADE per relationship;
`ON DELETE` never silently destroys append-only history; enums as native PG enums;
indexes on foreign keys, statuses, numbers, SLA deadlines; timestamps on all
operational tables; soft-delete (`deleted_at`) only where meaningful; transactions
wrap every multi-table invariant (assignment+history, stock movement, license seat,
approval decision+state transition); `jsonb` only for catalog form schemas, audit
before/after snapshots, and automation rule definitions. Retention/archival jobs
documented in Phase 6.

## 7. SLA Engine (the hardest part)

Unchanged from Rev 1: business-time calculation walking calendars (per-day windows,
timezone, holidays) — never naive timestamp subtraction; materialized `sla_instances`
per ticket × policy with pause intervals (configurable pause states); priority/category
changes recompute targets and log history; BullMQ repeatable sweep + threshold delayed
jobs that recheck live state; escalation chains fire once per threshold (idempotency
keys); indicator states within/approaching/breached/paused/met/missed.

## 8. Approval Engine

Unchanged from Rev 1: single reusable engine; rules instantiate steps
(single/all/any/sequential) with delegation, deadlines, reminders, rejection reasons,
request-info loops, cancellation, full history; deduped decisions enforced by a DB
unique constraint; SoD check blocks self-approval; service requests physically cannot
move to fulfillment until required steps are satisfied (service-layer gate).

## 9. UI/UX (per master brief §28, via ui-ux-pro-max at build time)

Unchanged from Rev 1: role-based nav, dashboards, TanStack Query tables with
saved views, ticket detail with tabs and timeline, Recharts drill-down, dark/light,
toasts/skeletons/empty states, responsive, keyboard-accessible. Design tokens in
Phase 1 via the ui-ux-pro-max skill.

## 10. Testing & Delivery

- **Vitest + RTL** for client units; **Supertest** for API integration tests mapped
  to the 25 master-brief acceptance workflows; **Playwright** e2e golden paths.
- **Integration-test database**: the dev machine has no Docker, so no
  testcontainers. Tests run against a dedicated `test` schema on the same Supabase
  project (`TEST_DATABASE_URL`), migrations applied at suite start, tables truncated
  between tests, parallelism off. Unit tests (priority calc, business-time math,
  validators) stay pure and need no database.
- Delivery: OpenAPI at `/api/docs`, README (install, bootstrap, Render + Supabase +
  Key Value setup, Docker, backup/restore via Supabase exports, implemented-vs-future
  integrations, limitations), `.env.example`, seed script (`prisma db seed`, demo
  data clearly labeled).

## 11. Build Order (mirrors taskplan.md)

1. **Foundation** — monorepo scaffold ✅ · Prisma schema (core tables) + migrations +
   connect · auth+bootstrap (convert to Prisma) · RBAC · users/departments/locations/
   groups · audit · client shell + design tokens + auth flows. *Verified by: auth/RBAC
   tests, audit trail written.*
2. **Core Service Desk** — tickets/incidents, queues, assignment, comments/work
   notes, attachments, timeline, employee portal. *Tests 1–4, 20.*
3. **SLA & Communication** — calendars, SLA engine, escalations, notifications,
   email interface, BullMQ infra. *Tests 5–8, 22.*
4. **Asset Management** — assets, assignments, maintenance, warranty, inventory,
   licenses, audits. *Tests 15–19.*
5. **Service Management** — catalog, requests, approval engine, knowledge base,
   problems, changes, major incidents. *Tests 8–14.*
6. **Automation & Reporting** — rules engine + history, reports/analytics, CSAT,
   exports, scheduled tasks. *Tests 21, 23.*
7. **Production Readiness** — security review, e2e suite, Docker/render.yaml polish,
   OpenAPI, docs, backup/restore, limitations list.

Each phase ends with: tests green → review → **ask user to commit & push**.
