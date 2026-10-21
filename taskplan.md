# ITSM Platform — Task Plan

Source design: [docs/superpowers/specs/2026-10-21-itsm-platform-design.md](docs/superpowers/specs/2026-10-21-itsm-platform-design.md)
Process: superpowers (brainstorm → design → plan → phased build, TDD where it counts).
After each phase: tests green → review → **ask user to commit & push** (no co-author lines).

## Phase 1 — Foundation
- [x] Monorepo scaffold: npm workspaces (`client`, `server`), TS configs, ESLint + Prettier
- [ ] Server: Express + config module (env validation via zod), Mongo connect, error handler, request logging (secret-free)
- [ ] Auth: register-free JWT sessions, login, refresh/expiry, session revocation, rate limiting (Redis), `/auth/bootstrap` (SETUP_TOKEN, locks after first admin)
- [ ] RBAC: permission catalog, `requireAuth` / `requirePermission` middleware, record-level scoping helpers
- [ ] Models: users, employees, departments, locations, assignmentGroups, groupMemberships, auditLogs, systemSettings (priority matrix, config), businessCalendars
- [ ] Audit service (auto-logged security-sensitive actions)
- [ ] Client: Vite + React + TS + Tailwind + shadcn/ui + router + TanStack Query; design tokens (light/dark) via ui-ux-pro-max; app shell (sidebar/topbar/global search), login page, role-based nav + route guards
- [ ] Seed script: demo org (departments, locations, groups, labeled demo users)
- ✅ Acceptance: login works for seeded roles; permission middleware blocks unauthorized API paths; audit entries written; dark/light theme

## Phase 2 — Core Service Desk
- [ ] Ticket model + number generator (`INC-2026-000001`), impact×urgency priority matrix (systemSettings-driven, override w/ reason)
- [ ] Ticket lifecycle: state machine, assignment/reassignment history, queues (unassigned, my, group), reopen rules
- [ ] Comments (public) vs work notes (internal) — query-level access control; attachments (upload/download auth); activity timeline
- [ ] Ticket detail page (summary, SLA chips, tabs), ticket lists (sort/filter/paginate/saved views), employee portal, create-incident flows
- [ ] Global search with record-level authorization
- ✅ Acceptance: spec tests 1–4, 20 (note invisibility, attachment authz)

## Phase 3 — SLA & Communication
- [ ] businessTime engine (calendars, holidays, TZ, pause states) + unit tests
- [ ] slaPolicies + slaInstances; recompute on priority/category change; pause/resume; indicators
- [ ] BullMQ infra: queues, retries+backoff, idempotency keys, failed-job log; repeatable SLA sweep + threshold delayed jobs (state rechecked)
- [ ] Escalation chains (once per threshold, auditable)
- [ ] Notifications: in-app inbox, preferences, Socket.IO live delivery; Nodemailer SMTP integration (dev-console mode clearly labeled) via background queue
- ✅ Acceptance: spec tests 5–8, 22 (approaching→warning, breach→escalation, no dupes on retry)

## Phase 4 — Asset Management
- [ ] Assets + lifecycle transitions; asset numbers; custodian; warranty
- [ ] assetAssignments (append-only custody, acknowledgment, return/reassign/loan)
- [ ] Maintenance: schedules, records, costs, vendor repairs; warranty claims
- [ ] Inventory: items, stockMovements (append-only), reorder threshold alerts, negative-stock guard
- [ ] Software licenses: seats, licenseAssignments, entitlement guard (+documented override)
- [ ] Asset audit sessions + items; asset reports
- [ ] Client pages: all-assets/hardware/software/assignments/maintenance/warranty/inventory/audits
- ✅ Acceptance: spec tests 15–19

## Phase 5 — Service Management
- [ ] Service catalog (dynamic form schemas, eligibility, icon/order, active state) + catalog admin UI
- [ ] Service requests: multi-item, states, fulfillment gating on approvals
- [ ] Approval engine: rules config, single/all/any/sequential, delegation, deadlines, reminders, SoD block, deduped decisions, full history
- [ ] Knowledge base: articles, revisions, states, visibility, search, feedback, resolved-ticket→draft-article
- [ ] Problem management: lifecycle, incident links, RCA, workaround vs permanent fix, recurring-incident detection
- [ ] Change management: types, risk assessment, plans, approval rules, scheduling conflicts w/ maintenance windows, PIR, failure/rollback tracking
- [ ] Major incidents: declaration criteria/permissions, commander, stakeholder comms, timeline (internal notes protected)
- ✅ Acceptance: spec tests 8–14

## Phase 6 — Automation & Reporting
- [ ] Automation rules engine: triggers/conditions/actions, validation-on-activate, loop/duplicate prevention, execution history (runs + node runs), admin UI
- [ ] Reports backend: all spec §20 metrics with precise definitions, date/dept/group filters, CSV export, print view; drill-down from dashboard charts
- [ ] CSAT: post-close survey, duplicate guard, reopen policy, aggregated reporting
- [ ] Scheduled tasks: warranty/maintenance/approval reminders, cleanup & archival jobs
- ✅ Acceptance: spec tests 21, 23

## Phase 7 — Production Readiness
- [ ] Security review pass (authz matrix e2e, injection, upload, headers, rate limits)
- [ ] Playwright e2e golden paths; full test suite green
- [ ] Dockerfile (multi-stage) + docker-compose.yml (app+mongo+redis) validated
- [ ] render.yaml blueprint (web service, env vars, optional worker service)
- [ ] OpenAPI docs served at `/api/docs`; all endpoints documented
- [ ] README: install, first-admin bootstrap, Render + Atlas + Key Value setup, Docker, backup/restore, implemented-vs-future integrations, limitations
- ✅ Acceptance: one-command local run; deployable on Render; docs complete

## Test mapping (spec §29 → suites)
1–4 → `server/tests/tickets/*.spec.ts` · 5–8 → `sla/*.spec.ts` · 8–14 → `approvals+changes+problems` · 15–19 → `assets/*.spec.ts` · 20 → `security/*.spec.ts` · 21 → `automation/*.spec.ts` · 22 → `jobs/idempotency.spec.ts` · 23 → `reports/*.spec.ts` · 24 → `search-authz.spec.ts` · 25 → `audit/*.spec.ts`
