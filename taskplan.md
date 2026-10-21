# ITSM Platform — Task Plan

Source design: [docs/superpowers/specs/2026-10-21-itsm-platform-design.md](docs/superpowers/specs/2026-10-21-itsm-platform-design.md) (Rev 2 — Supabase Postgres + Prisma)
Stack: React+TS (Render) · Express API (Render) · Supabase Postgres (relational) · Render Key Value (Redis/BullMQ) · Docker-ready.
Process: superpowers (brainstorm → design → plan → phased build). After each phase: tests green → review → **ask user to commit & push** (no co-author lines).

> Rev 2 note: DB switched from MongoDB Atlas/Mongoose to **Supabase Postgres + Prisma**
> (owner decision). Express API + JWT auth + RBAC design unchanged; model layer and
> data access rewritten relational. Completed Phase 1 work (scaffold) carries over.

## Phase 1 — Foundation
- [x] Monorepo scaffold: npm workspaces (`client`, `server`), TS configs, ESLint + Prettier
- [x] Prisma setup: schema.prisma (core tables: users, user_roles, sessions, employees, departments, locations, assignment_groups + members, audit_logs, system_settings, business_calendars + windows/holidays), client generation, connect module — *migrations pending Supabase credentials*
- [x] Convert server foundation to Prisma: auth (bootstrap/login/refresh rotation/reuse-detection/logout/me), users module, org module (departments/locations/groups w/ membership history), settings, audit; Mongoose layer removed
- [x] Server foundation verified: Express + zod env validation, error handler (Prisma P2002/P2025/P2003 mapped), secret-free request logging, helmet, rate limiting (Redis w/ memory fallback)
- [x] Auth design: JWT sessions, refresh rotation + reuse detection, revocation, rate limiting, `/auth/bootstrap` (SETUP_TOKEN, locks after first admin) — *conversion pending*
- [x] RBAC design: permission catalog + middleware + record-level scoping plan — *conversion pending*
- [x] Tests: integration suite against Supabase `test` schema (bootstrap, login, refresh rotation, RBAC 403s, audit written); pure unit tests for priority matrix — 10/10 green
- [x] Client: design tokens via ui-ux-pro-max; app shell (sidebar/topbar/global search), login page, role-based nav + route guards
- [x] Seed script (`prisma db seed`): demo org (departments, locations, groups, labeled demo users) + default business calendar + system settings
- ✅ Acceptance: login works for seeded roles; permission middleware blocks unauthorized API paths; audit entries written; dark/light theme

## Phase 2 — Core Service Desk
- [ ] Ticket table + number generator (`INC-2026-000001`), impact×urgency priority matrix (system_settings-driven, override w/ reason)
- [ ] Ticket lifecycle: state machine, assignment history, queues (unassigned, my, group), reopen rules
- [ ] Comments (public) vs work notes (internal) — query-level access control; attachments (Supabase Storage private bucket, mediated downloads); activity timeline
- [ ] Ticket detail page (summary, SLA chips, tabs), lists (sort/filter/paginate/saved views), employee portal, create-incident flows
- [ ] Global search with record-level authorization
- ✅ Acceptance: brief tests 1–4, 20 (note invisibility, attachment authz)

## Phase 3 — SLA & Communication
- [ ] businessTime engine (calendars, holidays, TZ, pause states) + unit tests
- [ ] sla_policies + sla_instances; recompute on priority/category change; pause/resume; indicators
- [ ] BullMQ infra: queues, retries+backoff, idempotency keys, failed-job log; repeatable SLA sweep + threshold delayed jobs (state rechecked)
- [ ] Escalation chains (once per threshold, auditable)
- [ ] Notifications: in-app inbox, preferences, Socket.IO live delivery; Nodemailer SMTP (dev-console mode clearly labeled) via background queue
- ✅ Acceptance: brief tests 5–8, 22 (approaching→warning, breach→escalation, no dupes on retry)

## Phase 4 — Asset Management
- [ ] Assets + lifecycle transitions; asset numbers; custodian; warranty
- [ ] asset_assignments (append-only custody, acknowledgment, return/reassign/loan; unique active-assignment constraint)
- [ ] Maintenance: schedules, records, costs, vendor repairs; warranty claims
- [ ] Inventory: items, stock_movements (append-only), reorder alerts, negative-stock guard in-transaction
- [ ] Software licenses: seats, license_assignments, entitlement guard (+documented override)
- [ ] Asset audit sessions + items; asset reports
- [ ] Client pages: all-assets/hardware/software/assignments/maintenance/warranty/inventory/audits
- ✅ Acceptance: brief tests 15–19

## Phase 5 — Service Management
- [ ] Service catalog (jsonb form schemas, eligibility, icon/order, active state) + catalog admin UI
- [ ] Service requests: multi-item, states, fulfillment gating on approvals
- [ ] Approval engine: rules config, single/all/any/sequential, delegation, deadlines, reminders, SoD block, DB-unique deduped decisions, full history
- [ ] Knowledge base: articles, revisions, states, visibility, search, feedback, resolved-ticket→draft-article
- [ ] Problem management: lifecycle, incident links, RCA, workaround vs permanent fix, recurring-incident detection
- [ ] Change management: types, risk assessment, plans, approval rules, scheduling conflicts w/ maintenance windows, PIR, failure/rollback tracking
- [ ] Major incidents: declaration criteria/permissions, commander, stakeholder comms, timeline (internal notes protected)
- ✅ Acceptance: brief tests 8–14

## Phase 6 — Automation & Reporting
- [ ] Automation rules engine: triggers/conditions/actions, validation-on-activate, loop/duplicate prevention, execution history (runs + node runs), admin UI
- [ ] Reports backend (SQL aggregates in prisma/sql/): all brief §20 metrics with precise definitions, date/dept/group filters, CSV export, print view; drill-down from dashboard charts
- [ ] CSAT: post-close survey, duplicate guard, reopen policy, aggregated reporting
- [ ] Scheduled tasks: warranty/maintenance/approval reminders, cleanup & archival jobs
- ✅ Acceptance: brief tests 21, 23

## Phase 7 — Production Readiness
- [ ] Security review pass (authz matrix e2e, injection, upload, headers, rate limits)
- [ ] Playwright e2e golden paths; full test suite green
- [ ] Dockerfile (multi-stage) + docker-compose.yml (app+postgres+redis) validated
- [ ] render.yaml blueprint (web service, env vars incl. Supabase DATABASE_URL/DIRECT_URL, optional worker service)
- [ ] OpenAPI docs served at `/api/docs`; all endpoints documented
- [ ] README: install, first-admin bootstrap, Render + Supabase + Key Value setup, Docker, backup/restore (Supabase exports), implemented-vs-future integrations, limitations
- ✅ Acceptance: one-command local run; deployable on Render; docs complete

## Test mapping (master brief §29 → suites)
1–4 → `server/tests/tickets/*.spec.ts` · 5–8 → `sla/*.spec.ts` · 8–14 → `approvals+changes+problems` · 15–19 → `assets/*.spec.ts` · 20 → `security/*.spec.ts` · 21 → `automation/*.spec.ts` · 22 → `jobs/idempotency.spec.ts` · 23 → `reports/*.spec.ts` · 24 → `search-authz.spec.ts` · 25 → `audit/*.spec.ts`
