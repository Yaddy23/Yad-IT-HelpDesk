# Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a knowledge base that is an integrated part of the service desk — employees find an answer before filing a ticket, technicians find documented procedures while resolving one, and a resolved ticket's resolution becomes a reviewed, published article.

**Architecture:** Three new Prisma models (`KnowledgeArticle`, `KnowledgeRevision`, `KnowledgeFeedback`) behind one `/api/v1/knowledge` router. Visibility is enforced at the Prisma query level by a single reusable `articleVisibilityWhere(user)` fragment, exactly as `ticketScopeWhere` already does for tickets — there is no frontend-only permission check anywhere. Article content lives in a plain `TEXT` column (never `jsonb`) and every content change appends an immutable `KnowledgeRevision` row, so history is never rewritten. The article row is the live pointer; `version` doubles as the current revision number and as the optimistic-concurrency token.

**Tech Stack:** Express 5 + Prisma 6 + Supabase Postgres (native PG enums, `TEXT[]` tag arrays), Zod validators, Vitest + Supertest against the `test` schema; React 18 + Vite + Tailwind v4 semantic tokens + TanStack Query v5; Playwright for e2e.

**Spec:** [docs/superpowers/specs/2026-10-21-itsm-platform-design.md](docs/superpowers/specs/2026-10-21-itsm-platform-design.md)

## Global Constraints

- `jsonb` is reserved for catalog form schemas, audit before/after snapshots, and automation rule definitions. **Article body, title and summary are real `String` columns.**
- **No frontend-only permission checks.** Every visibility rule is a Prisma `where` fragment applied in the service, and the client is a mirror of it, never the enforcement point.
- **No semantic/AI search** — tag + case-insensitive text matching only.
- **Internal work notes must never be reachable by requesters through any API path.** A ticket's internal comments are not a source for article content; only the ticket-level `resolutionNote` is.
- `ON DELETE` never silently destroys append-only history. `KnowledgeRevision` and `KnowledgeFeedback` history is `RESTRICT`-protected from cascading deletes.
- Native PG enums (lowercase snake_case values); indexes on foreign keys, statuses and sort columns; `$transaction` wraps every multi-table invariant.
- No `@@map` / `@@schema` anywhere — PascalCase model names become the literal quoted Postgres table names.
- ESM: every relative import carries an explicit `.js` extension even though the source is `.ts`.
- Every successful response wraps its payload in `data`; creates return `201`. Errors are thrown as `AppError` factories and formatted centrally.
- Server tests run against the dedicated `test` schema (`fileParallelism: false`, tables truncated between tests). They never import `seed.ts`.

## Review Focus

The five input classes most likely to bite a real user, each pinned to the task that owns the code:

1. **An employee passing `?status=draft` (or `in_review`/`archived`) to the list endpoint.** Expectation: unpublished content is never returned, whatever the caller asks for — the parameter is ignored for anyone without `kb:author`, not honored. → Task 2.
2. **A `restricted` article whose `allowedRoles` is empty.** Expectation: fail closed — visible to nobody but its author and a publisher. A `hasSome` fragment built from a mismatched or empty role list must not widen access. → Task 2.
3. **Converting a ticket that has no resolution note** (still open, or resolved with the note cleared). Expectation: a `400` with code `RESOLUTION_NOTE_REQUIRED`, never a draft article with an empty body. → Task 5.
4. **The same user voting twice with the opposite value.** Expectation: counters move by one, not two — helpful 1 / not-helpful 1 after a flip, never helpful 2. → Task 4.
5. **A search term that is nothing but LIKE wildcards (`%`, `_`, `%%`) or regex-special characters.** Expectation: `200` with an empty result set — no `500`, and no accidental match-everything. → Task 2.

---

### Task 1: Schema, migration and permission catalog

**Files:**
- Modify: `server/prisma/schema.prisma` (add two enums, three models, back-relations on `User`, `Employee`, `Ticket`, `NotificationPreference`)
- Create: `server/prisma/migrations/20261024090000_knowledge_base/migration.sql`
- Modify: `server/src/core/permissions.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `KnowledgeStatus`, `KnowledgeVisibility` enums; the `KnowledgeArticle`, `KnowledgeRevision`, `KnowledgeFeedback` Prisma models; the permissions `kb:read`, `kb:read_internal`, `kb:author`, `kb:publish` (all `keyof typeof PERMISSIONS`).

- [ ] **Step 1: Add the enums and models to `server/prisma/schema.prisma`**

Append a new `/* ── Knowledge base (Phase 5) ────────────────────────────────── */` section after the service-management section.

```prisma
enum KnowledgeStatus {
  draft
  in_review
  published
  archived
}

enum KnowledgeVisibility {
  public
  internal
  restricted
}

/// Live knowledge article. The row is the current pointer; every content
/// change appends an immutable KnowledgeRevision. `version` is both the
/// current revision number and the optimistic-concurrency token.
model KnowledgeArticle {
  id                String               @id @default(cuid())
  title             String
  summary           String?
  body              String
  category          String
  tags              String[]             @default([])
  status            KnowledgeStatus      @default(draft)
  visibility        KnowledgeVisibility  @default(internal)
  /// Only consulted when visibility = restricted; empty list = nobody but
  /// the author and a publisher can read it.
  allowedRoles      Role[]               @default([])
  authorId          String
  author            User                 @relation("knowledgeAuthor", fields: [authorId], references: [id])
  ownerId           String?
  owner             User?                @relation("knowledgeOwner", fields: [ownerId], references: [id])
  sourceTicketId    String?
  sourceTicket      Ticket?              @relation(fields: [sourceTicketId], references: [id])
  version           Int                  @default(1)
  publishedAt       DateTime?
  reviewIntervalDays Int                 @default(90)
  reviewDueAt       DateTime?
  helpfulCount      Int                  @default(0)
  notHelpfulCount   Int                  @default(0)
  revisions         KnowledgeRevision[]
  feedback          KnowledgeFeedback[]
  createdAt         DateTime             @default(now())
  updatedAt         DateTime             @updatedAt

  @@index([status, visibility])
  @@index([category, status])
  @@index([authorId])
  @@index([ownerId])
  @@index([sourceTicketId])
  @@index([reviewDueAt])
  @@index([updatedAt(sort: Desc)])
}

/// Append-only content history. A revision is a snapshot, never a delta:
/// restoring an old revision appends a NEW row whose content equals it.
/// Unique (articleId, revisionNumber) — a duplicated snapshot from a retry
/// is impossible at the DB level.
model KnowledgeRevision {
  id             String            @id @default(cuid())
  articleId      String
  article        KnowledgeArticle  @relation(fields: [articleId], references: [id], onDelete: Restrict)
  revisionNumber Int
  title          String
  summary        String?
  body           String
  category       String
  tags           String[]          @default([])
  visibility     KnowledgeVisibility
  allowedRoles   Role[]            @default([])
  changeNote     String?
  editorId       String
  editor         User              @relation("knowledgeEditor", fields: [editorId], references: [id])
  createdAt      DateTime          @default(now())

  @@unique([articleId, revisionNumber])
  @@index([articleId, createdAt(sort: Desc)])
}

/// One live vote per (article, user) — re-voting updates the row and the
/// counters move by the delta, so a flip can never double-count.
model KnowledgeFeedback {
  id        String            @id @default(cuid())
  articleId String
  article   KnowledgeArticle  @relation(fields: [articleId], references: [id], onDelete: Restrict)
  userId    String
  user      User              @relation("knowledgeFeedback", fields: [userId], references: [id])
  helpful   Boolean
  comment   String?
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt

  @@unique([articleId, userId])
  @@index([articleId, helpful])
}
```

Add the back-relations Prisma requires: on `User` add `knowledgeAuthored KnowledgeArticle[] @relation("knowledgeAuthor")`, `knowledgeOwned KnowledgeArticle[] @relation("knowledgeOwner")`, `knowledgeRevisions KnowledgeRevision[] @relation("knowledgeEditor")`, `knowledgeFeedback KnowledgeFeedback[] @relation("knowledgeFeedback")`. On `Ticket` add `knowledgeArticles KnowledgeArticle[]`. On `NotificationPreference` add `knowledge Boolean @default(true)`.

- [ ] **Step 2: Generate the migration**

Run (from `server/`): `npx prisma migrate dev --name knowledge_base --create-only`

Expected: Prisma writes `server/prisma/migrations/<timestamp>_knowledge_base/migration.sql` **without applying it**. Rename that folder to `20261024090000_knowledge_base`, then apply it with `npx prisma migrate dev`.

Rename **before** applying, never after: the name recorded in `_prisma_migrations` is the folder name at apply time, so renaming afterwards leaves the ledger diverged and the next `prisma migrate dev` offers a database reset.

Inspect the generated SQL and confirm it contains `CREATE TYPE "KnowledgeStatus"`, `CREATE TYPE "KnowledgeVisibility"`, `"allowedRoles" "Role"[]`, `"tags" TEXT[]`, `CREATE UNIQUE INDEX "KnowledgeRevision_articleId_revisionNumber_key"`, `CREATE UNIQUE INDEX "KnowledgeFeedback_articleId_userId_key"`, `ALTER TABLE "KnowledgeRevision" ADD CONSTRAINT ... ON DELETE RESTRICT`, and `ALTER TABLE "KnowledgeFeedback" ADD CONSTRAINT ... ON DELETE RESTRICT`.

- [ ] **Step 3: Extend the permission catalog**

In `server/src/core/permissions.ts`, add to `PERMISSIONS` under a `// knowledge base (Phase 5)` comment:

```ts
  'kb:read': 'Search and read published knowledge articles',
  'kb:read_internal': 'Read internal (IT-only) knowledge articles',
  'kb:author': 'Create and edit knowledge articles and submit them for review',
  'kb:publish': 'Approve, publish, archive and restore knowledge articles',
```

Change `EMPLOYEE_BASE` to `['tickets:create', 'tickets:read', 'kb:read']`. Add `'kb:read'` to `approver`. Add `'kb:read', 'kb:read_internal', 'kb:author'` to `it_technician`; add those three plus `'kb:publish'` to `it_manager` and to `it_admin`.

- [ ] **Step 4: Verify the schema and types compile**

Run: `npm run typecheck -w server`
Expected: PASS. A missing back-relation fails here with a Prisma validation error naming the relation.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations server/src/core/permissions.ts
git commit -m "feat: knowledge base schema, migration and permissions"
```

---

### Task 2: Visibility scoping, list/get/search service and router

**Files:**
- Create: `server/src/modules/knowledge/knowledge.service.ts`
- Create: `server/src/modules/knowledge/validators.ts`
- Create: `server/src/modules/knowledge/knowledge.routes.ts`
- Modify: `server/src/app.ts` (import + mount)
- Test: `server/tests/knowledge.spec.ts`

**Interfaces:**
- Consumes: the models and permissions from Task 1.
- Produces:
  - `export function articleVisibilityWhere(user: AuthedUser): Prisma.KnowledgeArticleWhereInput`
  - `export async function listArticles(user: AuthedUser, query: { q?: string; category?: string; status?: KnowledgeStatus; visibility?: KnowledgeVisibility; tag?: string; page: number; limit: number }): Promise<{ articles: ArticleSummary[]; total: number }>`
  - `export async function getArticle(user: AuthedUser, id: string): Promise<ArticleDetail>`
  - `export async function suggestArticles(user: AuthedUser, q: string, category: string | undefined, limit: number): Promise<ArticleSummary[]>`
  - `export async function listCategories(user: AuthedUser): Promise<string[]>`
  - `export const knowledgeRouter` mounted at `/api/v1/knowledge`

- [ ] **Step 1: Write the failing visibility tests**

Create `server/tests/knowledge.spec.ts` with the standard harness, copied in shape from `server/tests/serviceMgmt.spec.ts`: module-level `const app = createApp()`, `SETUP_TOKEN`, the user constants, the `let …Token` bindings, and a module-level `login()`; then a `beforeEach` that bootstraps with `POST /api/v1/auth/bootstrap`, logs in as `ADMIN`, defines the local `mkUser(body, roles)` helper, creates the four users and assigns every binding. Then:

```ts
it('lists only published articles to an employee', async () => {
  const res = await request(app).get('/api/v1/knowledge')
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(res.status).toBe(200);
  // `.every` is vacuously true on an empty array — pin the public fixture too.
  expect(res.body.data.some((a: { id: string }) => a.id === publishedPublicId)).toBe(true);
  expect(res.body.data.every((a: { status: string }) => a.status === 'published')).toBe(true);
});

it('ignores a status=draft filter from an employee', async () => {
  const res = await request(app).get('/api/v1/knowledge?status=draft')
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(res.status).toBe(200);
  expect(res.body.data).toHaveLength(0);
});

it('hides internal articles from an employee but shows them to a technician', async () => {
  const asEmployee = await request(app).get(`/api/v1/knowledge/${publishedInternalId}`)
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(asEmployee.status).toBe(404);
  const asTech = await request(app).get(`/api/v1/knowledge/${publishedInternalId}`)
    .set('Authorization', `Bearer ${techToken}`);
  expect(asTech.status).toBe(200);
});

it('fails closed for a restricted article with an empty allowedRoles list', async () => {
  const res = await request(app).get(`/api/v1/knowledge/${restrictedEmptyId}`)
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(res.status).toBe(404);
});

it('still lets a publisher read a restricted article whose role list is empty', async () => {
  const res = await request(app).get(`/api/v1/knowledge/${restrictedEmptyId}`)
    .set('Authorization', `Bearer ${mgrToken}`);
  expect(res.status).toBe(200);
  expect(res.body.data.id).toBe(restrictedEmptyId);
});

it('returns 200 and no results for a q of only LIKE wildcards', async () => {
  const res = await request(app).get('/api/v1/knowledge?q=%25%25')
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(res.status).toBe(200);
  expect(res.body.data).toHaveLength(0);
});
```

Seed the fixtures by creating them **through the API** in `beforeEach` (server tests never use `seed.ts`). Hold these module-level `let` bindings, assigned in `beforeEach`, and reuse them across every later task's tests in this file:

| Binding | What it is |
|---|---|
| `adminToken` | super_admin from `ADMIN` |
| `techToken` | an `it_technician` (has `kb:read`, `kb:read_internal`, `kb:author` — but not `kb:publish`) |
| `mgrToken` | an `it_manager` (adds `kb:publish`) |
| `employeeToken` | an `employee` (has `kb:read` only) |
| `publishedPublicId` | authored by the technician, published, `visibility: 'public'` |
| `publishedInternalId` | authored by the technician, published, `visibility: 'internal'` |
| `restrictedEmptyId` | authored by the technician, published, `visibility: 'restricted'`, `allowedRoles: []` — deliberately **not** authored by the manager, so the publisher-visibility test proves the `kb:publish` gate rather than the author gate |
| `draftId` | draft owned by the technician |
| `inReviewId` | draft submitted for review by the technician |
| `resolvedTicketId` | resolved with `resolutionNote: 'Restart the print spooler service and retry.'` |
| `openTicketId` | still open, `resolutionNote` null |

Tickets are created with `POST /api/v1/tickets` and resolved with `POST /api/v1/tickets/:id/transition` (`{ status: 'resolved', resolutionNote: '...', version }`) using `techToken`.

Two more things the spec file needs at module level, used by the tests in Tasks 3 and 5:

```ts
import { prisma } from '../src/prisma/client.js';

/** Minimum valid create payload — spread and override per test. */
const ARTICLE = {
  title: 'Reset your VPN password',
  summary: 'Steps to reset an expired VPN password from the self-service portal.',
  body: 'Open the self-service portal, choose Reset password, and follow the prompts.',
  category: 'Access',
  tags: ['vpn', 'password'],
  visibility: 'internal' as const,
};
```

`ARTICLE` omits `status` deliberately: a new article is always created as a `draft`, so `create` must not accept a `status` field. Every later test that needs a published or in-review article creates one from `ARTICLE` and then drives it through `submit`/`publish`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/knowledge.spec.ts -w server` (from `server/`)
Expected: FAIL — `404` from `notFoundHandler` for every request, because `/api/v1/knowledge` is not mounted.

- [ ] **Step 3: Write `articleVisibilityWhere` and the read service**

In `server/src/modules/knowledge/knowledge.service.ts`:

```ts
export function articleVisibilityWhere(user: AuthedUser): Prisma.KnowledgeArticleWhereInput {
  const seesUnpublished = can(user, 'kb:author');
  const seesInternal = can(user, 'kb:read_internal');
  const seesEverything = can(user, 'kb:publish');
  const roles = user.roles as Role[];

  const stateGate: Prisma.KnowledgeArticleWhereInput = seesUnpublished ? {} : { status: 'published' };
  const audienceGate: Prisma.KnowledgeArticleWhereInput = {
    OR: [
      { visibility: 'public' },
      ...(seesInternal ? [{ visibility: 'internal' as const }] : []),
      { visibility: 'restricted' as const, allowedRoles: { hasSome: roles } },
      // An author or owner always sees their own article, whatever its
      // audience gate says — otherwise a restricted article with an empty
      // allowedRoles list would be invisible to the person who wrote it.
      { authorId: user.id },
      { ownerId: user.id },
    ],
  };

  // A publisher reviews articles before they go live, so the audience gate
  // must not hide one from them; without this they could not review a
  // restricted article whose role list is empty.
  return seesEverything ? stateGate : { AND: [stateGate, audienceGate] };
}
```

`hasSome: []` matches nothing in Prisma, which is what makes an empty `allowedRoles` fail closed for everyone else — do not "simplify" it to an omitted clause, and do not drop the `authorId` / `ownerId` disjuncts, which are what keep the fail-closed rule from locking authors out of their own drafts. Note that `it_manager` and `it_admin` hold `kb:author` as well as `kb:publish`, so for them `stateGate` is already `{}`; the `seesEverything` short-circuit matters for the audience gate, not the state gate.

`listArticles` builds `where: { AND: [articleVisibilityWhere(user), ...] }`, adding `status` **only when `can(user, 'kb:author')`**, `category`, `tags: { has: tag }`, and a text `OR` over `title` / `summary` / `body` with `mode: 'insensitive'`. Returns `{ articles, total }` with a parallel `count()` and `skip`/`take`.

**Escape LIKE metacharacters before they reach Prisma.** Prisma's `contains` compiles to `ILIKE '%' || $1 || '%'` and does *not* escape the term, so a query of `%%` becomes `ILIKE '%%%'` and matches every row. Add this to the service and pass every user-supplied search term through it:

```ts
/** Escape LIKE metacharacters so a query of `%%` matches the literal text. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
```

Postgres uses backslash as the default `LIKE` escape character, so no `ESCAPE` clause is needed. Apply the same helper in `suggestArticles` and in the search-service article query in Task 5.

`getArticle` fetches with `where: { AND: [{ id }, articleVisibilityWhere(user)] }` and throws `notFound('Article not found')` when absent — a 404, never a 403, so scope is not disclosed.

`suggestArticles` searches only `status: 'published'` articles (never drafts, for anybody), matching `q` against title/summary/tags, ordered by `helpfulCount desc` then `updatedAt desc`. Tags are matched **exactly** (`hasSome` over the raw whitespace-split tokens) — `escapeLike` is only for the `contains` branches, since its backslashes would corrupt an exact array match.

- [ ] **Step 4: Write the validators and router, and mount it**

`validators.ts` follows the house wrapper convention: `z.object({ body: z.object({...}) })` for writes and a bare query schema parsed against `req.query` for reads. Article body is `z.string().min(20).max(50000)`; title `z.string().min(5).max(200)`; summary `.max(500).optional()`; tags `z.array(z.string().min(1).max(40)).max(10)`.

`knowledge.routes.ts` exports `knowledgeRouter = Router()` with `knowledgeRouter.use(requireAuth, requirePermission('kb:read'))` at the top, then — **literal routes before `/:id`** — `GET /`, `GET /categories`, `GET /suggest`, then `GET /:id`. Each handler is `async (req, res, next)` with `try { ... } catch (e) { next(e); }` and responds `res.json({ data })` / `res.json({ data, page, pages, total })`. Later tasks add `GET /review-due` (Task 4), `POST /from-ticket/:ticketId` (Task 5) and `GET /analytics` (Task 11) — all of them before `GET /:id`.

In `server/src/app.ts` add `import { knowledgeRouter } from './modules/knowledge/knowledge.routes.js';` and `app.use('/api/v1/knowledge', knowledgeRouter);` **after** the `apiLimiter` line and before the SPA fallback.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/knowledge.spec.ts` from `server/`
Expected: PASS (5/5).

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/knowledge server/src/app.ts server/tests/knowledge.spec.ts
git commit -m "feat: knowledge visibility scoping, list/get/search API"
```

---

### Task 3: Authoring lifecycle and revision history

**Files:**
- Modify: `server/src/modules/knowledge/knowledge.service.ts`
- Modify: `server/src/modules/knowledge/validators.ts`
- Modify: `server/src/modules/knowledge/knowledge.routes.ts`
- Test: `server/tests/knowledge.spec.ts`

**Interfaces:**
- Consumes: `articleVisibilityWhere`, `getArticle` from Task 2.
- Produces:
  - `export async function createArticle(user: AuthedUser, input: ArticleInput): Promise<ArticleDetail>`
  - `export async function updateArticle(user: AuthedUser, id: string, input: Partial<ArticleInput> & { version: number; changeNote?: string }): Promise<ArticleDetail>`
  - `export async function submitForReview(user: AuthedUser, id: string): Promise<ArticleDetail>`
  - `export async function publishArticle(user: AuthedUser, id: string): Promise<ArticleDetail>`
  - `export async function rejectArticle(user: AuthedUser, id: string, note: string): Promise<ArticleDetail>`
  - `export async function archiveArticle(user: AuthedUser, id: string): Promise<ArticleDetail>`
  - `export async function restoreArticle(user: AuthedUser, id: string): Promise<ArticleDetail>`
  - `export async function restoreRevision(user: AuthedUser, id: string, revisionNumber: number): Promise<ArticleDetail>`
  - `export async function listRevisions(user: AuthedUser, id: string): Promise<RevisionSummary[]>`
  - `export async function getRevision(user: AuthedUser, id: string, revisionNumber: number): Promise<RevisionSummary>`

- [ ] **Step 1: Write the failing lifecycle tests**

Add to `server/tests/knowledge.spec.ts`:

```ts
it('creates a draft and writes revision 1', async () => {
  const res = await request(app).post('/api/v1/knowledge')
    .set('Authorization', `Bearer ${techToken}`).send(ARTICLE);
  expect(res.status).toBe(201);
  expect(res.body.data.status).toBe('draft');
  const revs = await prisma.knowledgeRevision.findMany({ where: { articleId: res.body.data.id } });
  expect(revs).toHaveLength(1);
  expect(revs[0].revisionNumber).toBe(1);
});

it('moves a published article back to draft when its content is edited', async () => {
  const res = await request(app).patch(`/api/v1/knowledge/${publishedPublicId}`)
    .set('Authorization', `Bearer ${techToken}`)
    .send({ body: 'Rewritten body text for the article.', version: 1 });
  expect(res.status).toBe(200);
  expect(res.body.data.status).toBe('draft');
  expect(res.body.data.version).toBe(2);
});

it('refuses to publish without kb:publish', async () => {
  const res = await request(app).post(`/api/v1/knowledge/${inReviewId}/publish`)
    .set('Authorization', `Bearer ${techToken}`).send({});
  expect(res.status).toBe(403);
});

it('rejects a stale version with 409 STALE_VERSION', async () => {
  const res = await request(app).patch(`/api/v1/knowledge/${draftId}`)
    .set('Authorization', `Bearer ${techToken}`)
    .send({ title: 'A newer title', version: 99 });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('STALE_VERSION');
});

it('restores an old revision as a new revision without rewriting history', async () => {
  // Self-contained: create (rev 1), edit (rev 2), then restore rev 1 (rev 3).
  const created = await request(app).post('/api/v1/knowledge')
    .set('Authorization', `Bearer ${techToken}`).send({ ...ARTICLE, body: 'Original body content for this article.' });
  const id = created.body.data.id;

  const edited = await request(app).patch(`/api/v1/knowledge/${id}`)
    .set('Authorization', `Bearer ${techToken}`)
    .send({ body: 'Replacement body content for this article.', version: 1 });
  expect(edited.body.data.version).toBe(2);

  const res = await request(app).post(`/api/v1/knowledge/${id}/revisions/1/restore`)
    .set('Authorization', `Bearer ${techToken}`).send({});
  expect(res.status).toBe(200);
  expect(res.body.data.version).toBe(3);
  expect(res.body.data.body).toBe('Original body content for this article.');

  const revs = await prisma.knowledgeRevision.findMany({
    where: { articleId: id }, orderBy: { revisionNumber: 'asc' },
  });
  expect(revs.map((r) => r.revisionNumber)).toEqual([1, 2, 3]);
  expect(revs[1].body).toBe('Replacement body content for this article.'); // rev 2 was not overwritten
});
```

Also cover: `it('publishes an in_review article and stamps publishedAt and reviewDueAt')`, `it('rejects an in_review article back to draft with a note')`, `it('archives and restores a published article')`, `it('forbids an author editing an article they do not own')`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/knowledge.spec.ts`
Expected: FAIL — the write routes do not exist yet (`404`).

- [ ] **Step 3: Implement the lifecycle**

Every content write runs inside `prisma.$transaction` and follows the same shape:

1. Load the article scoped by `articleVisibilityWhere(user)`; `notFound` when absent.
2. Authorize: content edits require `can(user, 'kb:author')` **and** (`article.authorId === user.id || article.ownerId === user.id || can(user, 'kb:publish')`), else `forbidden('Missing permission: kb:author')`. Publishing/archiving/restoring requires `can(user, 'kb:publish')`, else `forbidden('Missing permission: kb:publish')`.
3. Guard concurrency with `where: { id, version: input.version }` and `updateMany`; when `count === 0` throw `conflict('Article was modified by someone else — reload and retry', 'STALE_VERSION')`.
4. Append a `KnowledgeRevision` whose `revisionNumber` equals the **new** version, carrying the new content.
5. `recordAudit` with action `knowledge.created` / `knowledge.updated` / `knowledge.submitted` / `knowledge.published` / `knowledge.rejected` / `knowledge.archived` / `knowledge.restored` / `knowledge.revision_restored` and `targetType: 'knowledge_article'`.

State transitions and their guards:

| From | To | Route | Guard |
|---|---|---|---|
| — | `draft` | `POST /` | `kb:author` |
| `draft` | `draft` | `PATCH /:id` | author/owner or `kb:publish` |
| `published` | `draft` | `PATCH /:id` | author/owner or `kb:publish` |
| `draft` | `in_review` | `POST /:id/submit` | author/owner |
| `in_review` | `published` | `POST /:id/publish` | `kb:publish`; stamps `publishedAt = now` and `reviewDueAt = now + reviewIntervalDays` |
| `in_review` | `draft` | `POST /:id/reject` | `kb:publish`; requires a non-empty `note` (else `badRequest('A reason is required', 'REASON_REQUIRED')`) |
| `published` | `archived` | `POST /:id/archive` | `kb:publish` |
| `archived` | `published` | `POST /:id/restore` | `kb:publish` |

Any other transition throws `conflict('Cannot move an article from <from> to <to>', 'INVALID_TRANSITION')`.

`restoreRevision` reads revision N, then appends revision `version + 1` whose content equals revision N — history is never mutated, and revision numbers never repeat.

- [ ] **Step 4: Add the routes**

Add to `knowledge.routes.ts`, all `requireAuth` + the permission noted above: `POST /`, `PATCH /:id`, `POST /:id/submit`, `POST /:id/publish`, `POST /:id/reject`, `POST /:id/archive`, `POST /:id/restore`, `GET /:id/revisions`, `GET /:id/revisions/:revisionNumber`, `POST /:id/revisions/:revisionNumber/restore`. `POST` with an optional body parses `{ params: req.params, body: req.body ?? {} }` — an empty body otherwise throws.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/knowledge.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/knowledge server/tests/knowledge.spec.ts
git commit -m "feat: knowledge article lifecycle and revision history"
```

---

### Task 4: Feedback, review-reminder sweep and notification preference

**Files:**
- Modify: `server/src/modules/knowledge/knowledge.service.ts`
- Modify: `server/src/modules/knowledge/knowledge.routes.ts`
- Modify: `server/src/modules/notifications/notifications.service.ts`
- Modify: `server/src/modules/notifications/notifications.routes.ts`
- Modify: `server/src/jobs/scheduler.ts`
- Test: `server/tests/knowledge.spec.ts`

**Interfaces:**
- Consumes: `createNotification` from `notifications.service`; the scheduler's sweep wiring from the existing `runSlaSweep` / `runApprovalSweep` precedent.
- Produces:
  - `export async function submitFeedback(user: AuthedUser, id: string, input: { helpful: boolean; comment?: string }): Promise<{ helpfulCount: number; notHelpfulCount: number; myVote: boolean | null }>`
  - `export async function listReviewDue(user: AuthedUser): Promise<ArticleSummary[]>`
  - `export async function runKnowledgeReviewSweep(now?: Date): Promise<{ checked: number; reminded: number }>`
  - Routes: `POST /api/v1/knowledge/:id/feedback` (any holder of `kb:read`), and `GET /api/v1/knowledge/review-due` (requires `kb:author`; literal route, registered before `/:id`)
  - `getArticle` additionally returns `myVote: boolean | null`
  - `NotificationPreference.knowledge` (Prisma column), `knowledge` in the preferences zod schema, and `kb.` handling in `deliver()`

- [ ] **Step 1: Write the failing tests**

Add `import { runKnowledgeReviewSweep } from '../src/modules/knowledge/knowledge.service.js';` to the spec's imports. The sweep is called **directly**, not through the scheduler: `isTest` short-circuits `startScheduler()` entirely, so nothing would ever run it in the test environment.

```ts
it('records a helpful vote and increments the counter', async () => {
  const res = await request(app).post(`/api/v1/knowledge/${publishedPublicId}/feedback`)
    .set('Authorization', `Bearer ${employeeToken}`).send({ helpful: true });
  expect(res.status).toBe(200);
  expect(res.body.data.helpfulCount).toBe(1);
});

it('flips a vote without double counting', async () => {
  await request(app).post(`/api/v1/knowledge/${publishedPublicId}/feedback`)
    .set('Authorization', `Bearer ${employeeToken}`).send({ helpful: true });
  const flip = await request(app).post(`/api/v1/knowledge/${publishedPublicId}/feedback`)
    .set('Authorization', `Bearer ${employeeToken}`).send({ helpful: false });
  expect(flip.body.data.helpfulCount).toBe(0);
  expect(flip.body.data.notHelpfulCount).toBe(1);
});

it('reminds the owner once per due date and not twice', async () => {
  const first = await runKnowledgeReviewSweep(new Date('2030-01-01T00:00:00Z'));
  const second = await runKnowledgeReviewSweep(new Date('2030-01-01T00:00:00Z'));
  expect(first.reminded).toBeGreaterThan(0);
  expect(second.reminded).toBe(0);
});

it('does not remind an article that is not due', async () => {
  const result = await runKnowledgeReviewSweep(new Date('2026-01-01T00:00:00Z'));
  expect(result.reminded).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/knowledge.spec.ts`
Expected: FAIL — `runKnowledgeReviewSweep` is not exported.

- [ ] **Step 3: Implement feedback**

`submitFeedback` runs in `$transaction`: read the caller's existing `KnowledgeFeedback` for the article, then `upsert` on the `(articleId, userId)` unique. Compute the delta from the previous vote and apply it with a single `prisma.knowledgeArticle.update` using `increment` on `helpfulCount` / `notHelpfulCount` — never recompute from a `count()` inside the same transaction, which would race. Return the post-update counters.

The article must be readable by the caller (reuse `getArticle`'s scope check first) — feedback on an out-of-scope article is a `404`.

`listReviewDue` returns published articles whose `reviewDueAt <= now`, ordered by `reviewDueAt asc`, scoped by `articleVisibilityWhere(user)` so a manager sees the same set the sweep will remind. Register `GET /review-due` with `requirePermission('kb:author')` **before** `GET /:id`, and add the `POST /:id/feedback` route (no extra permission beyond the router-level `kb:read` — any signed-in reader may rate).

- [ ] **Step 4: Implement the review sweep**

```ts
export async function runKnowledgeReviewSweep(now = new Date()): Promise<{ checked: number; reminded: number }>
```

Select `where: { status: 'published', reviewDueAt: { lte: now } }`, `take: 500`, `orderBy: { reviewDueAt: 'asc' }`. For each, notify `ownerId ?? authorId` with `type: 'kb.review_due'` and `dedupeKey: \`kb.review_due:${article.id}:${article.reviewDueAt.toISOString()}\``. The dedupe key carries the due date, so the reminder fires once per review cycle and a re-run is a no-op. Bounded with `take`/`orderBy` like the two existing sweeps.

**Count `reminded` yourself — `createNotification` cannot tell you.** Its signature is `Promise<void>` and it *swallows* the P2002 that a duplicate `dedupeKey` raises (`notifications.service.ts:68-72`), so a sweep that increments `reminded` per call would report the same count on every re-run and the "not twice" test could never pass. Check for the key first and only count what you actually create:

```ts
const dedupeKey = `kb.review_due:${article.id}:${article.reviewDueAt.toISOString()}`;
const already = await prisma.notification.findFirst({ where: { dedupeKey }, select: { id: true } });
if (already) continue;
await createNotification({ userId: article.ownerId ?? article.authorId, type: 'kb.review_due', title: ..., body: ..., dedupeKey });
reminded += 1;
```

Increment `checked` for every article the query returned, `reminded` only for the ones you notified. The pre-check is not a lock — two concurrent sweeps could still both pass it, and the unique index is what actually guarantees one notification; the check exists so the returned count is truthful.

- [ ] **Step 5: Add the `knowledge` notification preference**

Four coupled edits — missing any one degrades silently:

1. `server/prisma/schema.prisma`: `NotificationPreference.knowledge Boolean @default(true)` (already added in Task 1's migration).
2. `notifications.routes.ts`: add `knowledge: z.boolean().optional()` to `prefsSchema`.
3. `notifications.service.ts` `updatePreferences` patch type: add `knowledge: boolean`.
4. `notifications.service.ts` `deliver()`: the current catch-all is `if (!row.type.startsWith('sla.') && !prefs.ticketUpdate) return;`. Add `kb.` to the exempt prefixes so a KB reminder is gated by the `knowledge` flag, not by `ticketUpdate`:

```ts
if (row.type.startsWith('kb.') && prefs && !prefs.knowledge) return;
if (!row.type.startsWith('sla.') && !row.type.startsWith('kb.') && !prefs?.ticketUpdate) return;
```

- [ ] **Step 6: Wire the sweep into the scheduler**

In `server/src/jobs/scheduler.ts` add a `runKnowledgeReviewSweep()` call in **both** the BullMQ worker branch for the sweep job and the `startInMemory` `setInterval` callback, next to `runApprovalSweep()`. A sweep added to only one path silently never runs in dev.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/knowledge.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/modules/knowledge server/src/modules/notifications server/src/jobs/scheduler.ts server/tests/knowledge.spec.ts
git commit -m "feat: knowledge feedback, review reminders and notification preference"
```

---

### Task 5: Ticket-to-draft conversion and global search integration

**Files:**
- Modify: `server/src/modules/knowledge/knowledge.service.ts`
- Modify: `server/src/modules/knowledge/knowledge.routes.ts`
- Modify: `server/src/modules/search/search.service.ts`
- Test: `server/tests/knowledge.spec.ts`

**Interfaces:**
- Consumes: `createArticle` from Task 3; `assertCanView` and `ticketScopeWhere` from `tickets.service`; `articleVisibilityWhere` from Task 2.
- Produces:
  - `export async function createDraftFromTicket(user: AuthedUser, ticketId: string): Promise<ArticleDetail>`
  - `POST /api/v1/knowledge/from-ticket/:ticketId`
  - `SearchResults.articles: { id: string; title: string; summary: string | null; category: string; helpfulCount: number }[]`

- [ ] **Step 1: Write the failing tests**

```ts
it('creates an internal draft from a resolved ticket resolution', async () => {
  const res = await request(app).post(`/api/v1/knowledge/from-ticket/${resolvedTicketId}`)
    .set('Authorization', `Bearer ${techToken}`).send({});
  expect(res.status).toBe(201);
  expect(res.body.data.status).toBe('draft');
  expect(res.body.data.visibility).toBe('internal');
  expect(res.body.data.body).toBe('Restart the print spooler service and retry.');
});

it('refuses to convert a ticket with no resolution note', async () => {
  const res = await request(app).post(`/api/v1/knowledge/from-ticket/${openTicketId}`)
    .set('Authorization', `Bearer ${techToken}`).send({});
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('RESOLUTION_NOTE_REQUIRED');
});

it('includes published articles in global search', async () => {
  const res = await request(app).get('/api/v1/search?q=spooler')
    .set('Authorization', `Bearer ${employeeToken}`);
  expect(res.body.data.articles.length).toBeGreaterThan(0);
});

it('never returns a draft article through global search', async () => {
  const res = await request(app).get('/api/v1/search?q=spooler')
    .set('Authorization', `Bearer ${techToken}`);
  expect(res.body.data.articles.every((a: { id: string }) => a.id !== draftId)).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/knowledge.spec.ts`
Expected: FAIL — route not mounted, `data.articles` undefined.

- [ ] **Step 3: Implement `createDraftFromTicket`**

Load the ticket, then `await assertCanView(user, ticket)` so an out-of-scope ticket is a `404`. Require `can(user, 'kb:author')`, else `forbidden('Missing permission: kb:author')`. Require `(ticket.status === 'resolved' || ticket.status === 'closed') && ticket.resolutionNote?.trim()`; otherwise `badRequest('This ticket has no resolution to convert', 'RESOLUTION_NOTE_REQUIRED')`.

Create the draft through the same internal path `createArticle` uses, with `title: ticket.title`, `body: ticket.resolutionNote`, `category: ticket.category`, `summary: null`, `tags: []`, `visibility: 'internal'`, `sourceTicketId: ticket.id`, and `ownerId: user.id`.

**`visibility: 'internal'` is deliberate and must not be changed to `public`:** converting a ticket must never publish anything to employees without a human reviewer, and the ticket's internal work notes are never read — only `resolutionNote`, which is already visible to the requester through `ticketPublicSelect`.

Add the route **before** `GET /:id` so `/from-ticket/...` is not captured as an `:id`.

- [ ] **Step 4: Add the articles group to global search**

Extend `SearchResults` in `server/src/modules/search/search.service.ts` with the `articles` array, and add a third entry to the `Promise.all`:

```ts
prisma.knowledgeArticle.findMany({
  where: {
    AND: [
      articleVisibilityWhere(user),
      { status: 'published' },
      { OR: [
        { title: { contains: term, mode: 'insensitive' } },
        { summary: { contains: term, mode: 'insensitive' } },
        { body: { contains: term, mode: 'insensitive' } },
        { tags: { has: term } },
      ] },
    ],
  },
  orderBy: [{ helpfulCount: 'desc' }, { updatedAt: 'desc' }],
  take: limit,
  select: { id: true, title: true, summary: true, category: true, helpfulCount: true },
}),
```

The explicit `status: 'published'` keeps drafts out of search results even for authors. Return `articles` alongside `tickets` and `people`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/knowledge.spec.ts tests/search.spec.ts`
Expected: PASS for both — the existing search spec must not regress.

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/knowledge server/src/modules/search server/tests/knowledge.spec.ts
git commit -m "feat: ticket-to-draft knowledge conversion and article search results"
```

---

### Task 6: Demo seed articles

**Files:**
- Modify: `server/prisma/seed.ts`

**Interfaces:**
- Consumes: the models from Task 1.
- Produces: three published demo articles (one `public`, one `internal`, one `restricted` to `it_manager`) authored by the seeded technician, so the client pages and the Playwright suite have data on a fresh seed.

- [ ] **Step 1: Add a count-guarded seed block**

Follow the existing `if (catalogCount === 0) { ... }` pattern. Create the articles with a nested `revisions: { create: { ... } }` so each seeded article also has revision 1 — the invariant every other code path maintains. Set `status: 'published'`, `publishedAt: new Date()`, `reviewDueAt` 90 days out, and `helpfulCount`/`notHelpfulCount` left at 0 (seeded counters must not disagree with the feedback table). No counter table is involved, so there is nothing to bump.

- [ ] **Step 2: Run the seed against the dev database**

Run: `npm run db:seed -w server`
Expected: completes without error; re-running it is a no-op (the count guard short-circuits).

- [ ] **Step 3: Verify the articles are queryable**

Run: `npm run dev:server` is already running; then in a second shell, `curl -s -H "Authorization: Bearer <demo admin token>" http://localhost:5000/api/v1/knowledge | head -c 400`
Expected: `{"data":[{...` containing the seeded titles.

- [ ] **Step 4: Commit**

```bash
git add server/prisma/seed.ts
git commit -m "chore: seed demo knowledge articles"
```

---

### Task 7: Client API module, badges, icon, nav and routes

**Files:**
- Create: `client/src/lib/knowledgeApi.ts`
- Create: `client/src/components/KnowledgeBadges.tsx`
- Modify: `client/src/components/icons.tsx`
- Modify: `client/src/lib/nav.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/lib/searchApi.ts`
- Modify: `client/src/lib/notificationsApi.ts`
- Modify: `client/src/pages/NotificationsPage.tsx`

**Interfaces:**
- Consumes: the server payloads from Tasks 2–5.
- Produces: `knowledgeApi` (`list`, `get`, `suggest`, `categories`, `reviewDue`, `create`, `update`, `submit`, `publish`, `reject`, `archive`, `restore`, `revisions`, `restoreRevision`, `feedback`, `fromTicket`); `KnowledgeStatusBadge`, `KnowledgeVisibilityBadge`, `KNOWLEDGE_STATUS_LABELS`; `BookIcon`.

- [ ] **Step 1: Write `client/src/lib/knowledgeApi.ts`**

Mirror `serviceApi.ts`: import `{ api, type ApiEnvelope }` from `./api`, declare the domain types (`KnowledgeStatus`, `KnowledgeVisibility`, `KnowledgeArticle`, `KnowledgeRevision`, `ArticleInput`), then export one `const knowledgeApi = { ... }`. Reads declare `Promise<T>` and unwrap with `(await api.get<ApiEnvelope<T>>(url)).data.data`; writes return the raw axios promise. Paths are relative to the `/api/v1` baseURL.

- [ ] **Step 2: Write `client/src/components/KnowledgeBadges.tsx`**

Copy the `ServiceBadges.tsx` shape exactly: a `Record<KnowledgeStatus, string>` class map, a `Record<KnowledgeStatus, string>` label map, and a small component indexing both. Reuse the token vocabulary already in use — `published` uses the accent tint (`bg-accent/10 text-accent border-accent/40`), `draft` the muted one (`bg-muted text-muted-foreground border-border`), `in_review` the warning tint, `archived` the secondary tint. Export `KNOWLEDGE_STATUS_LABELS` for reuse.

- [ ] **Step 3: Add `BookIcon` to `icons.tsx`**

Follow the file's contract: `export const BookIcon = (p: IconProps) => (<svg {...base(p)}>...</svg>)` with 24×24 stroke paths for an open book. No emoji, no icon library.

- [ ] **Step 4: Add the nav entry and routes**

In `client/src/lib/nav.ts` add to the `work` section:

```ts
{ label: 'Knowledge', to: '/knowledge', icon: BookIcon, permissions: ['kb:read'], section: 'work' },
```

In `client/src/App.tsx`, import the four new pages plus `BookIcon` is not needed here, and register **inside the `AppShell` block, before the catch-all**:

```tsx
<Route path="knowledge" element={<ProtectedRoute permissions={['kb:read']}><KnowledgePage /></ProtectedRoute>} />
<Route path="knowledge/new" element={<ProtectedRoute permissions={['kb:author']}><KnowledgeEditorPage /></ProtectedRoute>} />
<Route path="knowledge/:id" element={<ProtectedRoute permissions={['kb:read']}><KnowledgeArticlePage /></ProtectedRoute>} />
<Route path="knowledge/:id/edit" element={<ProtectedRoute permissions={['kb:author']}><KnowledgeEditorPage /></ProtectedRoute>} />
<Route path="admin/knowledge" element={<ProtectedRoute permissions={['kb:publish']}><KnowledgeAdminPage /></ProtectedRoute>} />
```

`knowledge/new` and `knowledge/:id/edit` must be declared **before** `knowledge/:id`, or React Router matches `new` as an id. While in this file, delete the dead duplicate `path="approvals"` route (the one rendering `<PlaceholderPage title="Approvals" phase="Phase 5" />`) — it is unreachable and misleading.

- [ ] **Step 5: Extend the search and notification client mirrors**

`client/src/lib/searchApi.ts`: add `SearchResultArticle` and `articles: SearchResultArticle[]` to `SearchResults`.
`client/src/lib/notificationsApi.ts`: add `knowledge: boolean` to `NotificationPreferences`.
`client/src/pages/NotificationsPage.tsx`: add `knowledge: 'Knowledge base reminders'` to `PREF_LABELS` — omitting it breaks the `Record<keyof NotificationPreferences, string>` type.

- [ ] **Step 6: Verify it compiles**

Run: `npm run typecheck -w client`
Expected: PASS. (The four page files must exist as minimal default-exported stubs for this to pass; create them in this step if you are running the tasks out of order.)

- [ ] **Step 7: Commit**

```bash
git add client/src/lib client/src/components client/src/App.tsx client/src/pages/NotificationsPage.tsx
git commit -m "feat: knowledge client API, badges, nav and routes"
```

---

### Task 8: Knowledge browse page and article page

**Files:**
- Create: `client/src/pages/KnowledgePage.tsx`
- Create: `client/src/pages/KnowledgeArticlePage.tsx`

**Interfaces:**
- Consumes: `knowledgeApi`, `KnowledgeStatusBadge`, `KnowledgeVisibilityBadge` from Task 7.
- Produces: `/knowledge` browse+search, `/knowledge/:id` article with feedback and a revision-history dialog.

- [ ] **Step 1: Build `KnowledgePage.tsx`**

Copy the list-page pattern from `MyRequestsPage.tsx` verbatim in structure: `useSearchParams` filters rendered as pill buttons (category + a search input), TanStack Query keyed `['knowledge', { q, category, page }]`, skeleton loading (`animate-hidden` → use the existing `animate-pulse rounded-md bg-muted` skeleton), `role="alert"` error via `apiErrorMessage`, an empty state, and a result list. Each result is a `Link` to `/knowledge/:id` showing title, summary, category, `KnowledgeVisibilityBadge`, and the helpful count. A "New article" button links to `/knowledge/new` and renders only when `hasAnyPermission(['kb:author'])`.

The search input is debounced 250ms with a 2-character minimum, matching `GlobalSearch.tsx`.

- [ ] **Step 2: Build `KnowledgeArticlePage.tsx`**

`useParams` for the id, `useQuery(['knowledge', id])`. Render the title, status/visibility badges, category, tags, and the body in a `<div className="whitespace-pre-wrap">{article.body}</div>` — **plain text, no markdown renderer and no `dangerouslySetInnerHTML`**, so an article body containing `<script>` renders literally. Add the "Was this helpful?" block with Helpful / Not helpful buttons and an optional comment textarea, driven by `useMutation(knowledgeApi.feedback)` that invalidates `['knowledge', id]` and reflects `myVote`. Show author/owner, `publishedAt`, and `reviewDueAt` when present. For users with `kb:author`, render a "Revision history" button opening a dialog listing revisions with a "Restore" action per row.

Use the house dialog markup: backdrop `fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4` with `role="dialog"`, `aria-modal="true"`, `aria-label`, and `onKeyDown` Escape handling. Declare the file-local `inputClass` / `buttonPrimary` / `buttonGhost` constants by copying the literals — there is no shared UI kit.

- [ ] **Step 3: Verify in the browser**

Run the app (`npm run dev` at the repo root) and, as `admin@demo.local` / `ChangeMe!2026`, visit `/knowledge`. Confirm the seeded articles list, an article opens, the Helpful button increments the count, and Escape closes the revision dialog.

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck -w client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/KnowledgePage.tsx client/src/pages/KnowledgeArticlePage.tsx
git commit -m "feat: knowledge browse and article pages with feedback"
```

---

### Task 9: Knowledge editor page

**Files:**
- Create: `client/src/pages/KnowledgeEditorPage.tsx`

**Interfaces:**
- Consumes: `knowledgeApi.create`, `knowledgeApi.update`, `knowledgeApi.submit` from Task 7.
- Produces: `/knowledge/new` and `/knowledge/:id/edit`.

- [ ] **Step 1: Build the editor**

A single page serving both routes: when `useParams().id` is present, load the article and prefill; otherwise start empty. Fields: title (`input`, min 5 max 200), summary (`textarea`, max 500), body (`textarea` with `rows={18}`, min 20 max 50000), category (text input with a datalist of `knowledgeApi.categories()`), tags (comma-separated text parsed to a trimmed, de-duplicated array of at most 10), visibility (`select`: public / internal / restricted), `allowedRoles` (checkbox list over the six roles, rendered only when visibility is `restricted`), and `reviewIntervalDays` (number, default 90).

Two actions: **Save draft** (`create` or `update` with the article's current `version`) and **Submit for review** (`submit` after a successful save). Surface errors with `apiErrorMessage` in a `role="alert"` paragraph. On success, invalidate `['knowledge']` and navigate to `/knowledge/:id`.

When editing a `published` article, render a visible notice that saving returns it to draft pending re-approval, so the behaviour is not a surprise.

- [ ] **Step 2: Verify the flow in the browser**

As an `it_technician` demo user, create an article, submit it for review, and confirm its badge reads "In review" on `/knowledge/:id`. Then save an edit to a published article and confirm the badge flips to "Draft".

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck -w client`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/KnowledgeEditorPage.tsx
git commit -m "feat: knowledge article editor page"
```

---

### Task 10: Knowledge review and administration page

**Files:**
- Create: `client/src/pages/KnowledgeAdminPage.tsx`

**Interfaces:**
- Consumes: `knowledgeApi` review-due, list, publish, reject, archive, restore.
- Produces: `/admin/knowledge`.

- [ ] **Step 1: Build the admin page**

Three sections on one page, each its own `useQuery`:

1. **Awaiting review** — `knowledgeApi.list({ status: 'in_review' })`. Each row offers Publish and Reject; Reject opens a dialog requiring a non-empty reason before it submits, because the server returns `REASON_REQUIRED` otherwise.
2. **All articles** — `knowledgeApi.list({ page })` with a status filter and a paginated table (title, status, visibility, category, author, updated). Rows offer Archive (when published) or Restore (when archived).
3. **Review due** — `knowledgeApi.reviewDue()`, listing published articles past `reviewDueAt` with their owner and due date.

Every mutation invalidates `['knowledge']` so all three sections refresh.

- [ ] **Step 2: Verify the flow in the browser**

As `admin@demo.local`, visit `/admin/knowledge`, publish an article that is in review, confirm it appears under All articles as Published, then archive and restore it.

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck -w client`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/KnowledgeAdminPage.tsx
git commit -m "feat: knowledge review and administration page"
```

---

### Task 11: Article analytics

**Files:**
- Modify: `server/src/modules/knowledge/knowledge.service.ts`
- Modify: `server/src/modules/knowledge/knowledge.routes.ts`
- Modify: `client/src/lib/knowledgeApi.ts`
- Modify: `client/src/pages/KnowledgeAdminPage.tsx`
- Test: `server/tests/knowledge.spec.ts`

**Interfaces:**
- Consumes: the models from Task 1; `knowledgeApi` from Task 7; the admin page from Task 10.
- Produces:
  - `export async function getAnalytics(user: AuthedUser): Promise<KnowledgeAnalytics>`
  - `GET /api/v1/knowledge/analytics` (requires `kb:publish`)
  - `knowledgeApi.analytics()`

```ts
export interface KnowledgeAnalytics {
  totals: { published: number; draft: number; in_review: number; archived: number };
  fromTickets: number;
  reviewOverdue: number;
  topHelpful: { id: string; title: string; helpfulCount: number; notHelpfulCount: number }[];
  needsReview: { id: string; title: string; helpfulCount: number; notHelpfulCount: number; notHelpfulRatio: number }[];
}
```

- [ ] **Step 1: Write the failing test**

```ts
it('reports knowledge analytics to a publisher and refuses a technician', async () => {
  const asTech = await request(app).get('/api/v1/knowledge/analytics')
    .set('Authorization', `Bearer ${techToken}`);
  expect(asTech.status).toBe(403);

  const res = await request(app).get('/api/v1/knowledge/analytics')
    .set('Authorization', `Bearer ${mgrToken}`);
  expect(res.status).toBe(200);
  expect(res.body.data.totals.published).toBeGreaterThan(0);
  expect(res.body.data.fromTickets).toBeGreaterThan(0);
  expect(Array.isArray(res.body.data.needsReview)).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/knowledge.spec.ts`
Expected: FAIL — `404`, the route does not exist.

- [ ] **Step 3: Implement `getAnalytics`**

`totals` comes from one `prisma.knowledgeArticle.groupBy({ by: ['status'], _count: true })`. `fromTickets` is `count({ where: { sourceTicketId: { not: null } } })`. `reviewOverdue` is `count({ where: { status: 'published', reviewDueAt: { lte: new Date() } } })`. `topHelpful` is the top 10 published articles by `helpfulCount desc`. `needsReview` is published articles with `notHelpfulCount >= 3` ordered by the not-helpful ratio descending, computed in JS from the counts returned (Prisma cannot order by a computed ratio without raw SQL, and raw SQL is not warranted here).

**Be honest about what this measures.** It cannot show that an article reduced ticket volume — that would require correlating article reads against tickets that were never filed. What it does report is which articles were born from real resolutions, which are rated unhelpful, and which are overdue for review. Name the section on the page accordingly rather than labelling it "deflection".

- [ ] **Step 4: Add the route and the admin page section**

Add `GET /analytics` to `knowledge.routes.ts` with `requirePermission('kb:publish')`, **before** `GET /:id`. On the admin page add a fourth section, "Article health", rendering the totals as stat rows, the `fromTickets` and `reviewOverdue` numbers, and the two lists.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/knowledge.spec.ts`
Expected: PASS.

- [ ] **Step 6: Verify it compiles**

Run: `npm run typecheck -w client && npm run typecheck -w server`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/knowledge server/tests/knowledge.spec.ts client/src/lib/knowledgeApi.ts client/src/pages/KnowledgeAdminPage.tsx
git commit -m "feat: knowledge article analytics"
```

---

### Task 12: Ticket integration — create-time suggestions and resolution-to-article

**Files:**
- Modify: `client/src/pages/TicketCreatePage.tsx`
- Modify: `client/src/pages/TicketDetailPage.tsx`
- Modify: `client/src/components/GlobalSearch.tsx`

**Interfaces:**
- Consumes: `knowledgeApi.suggest`, `knowledgeApi.fromTicket`; `SearchResults.articles` from Task 7.
- Produces: article suggestions while typing a ticket; a "Create knowledge article" action on a resolved ticket; an Articles group in the top-bar search.

- [ ] **Step 1: Add suggestions to the ticket create form**

Below the title and description fields, add a `useQuery(['knowledge-suggest', debouncedTitle, category], () => knowledgeApi.suggest(debouncedTitle, category), { enabled: debouncedTitle.length >= 2 })`. Render up to 3 results in a bordered panel headed "These articles might already answer this" — each a `Link` to `/knowledge/:id` opening in a new tab, plus a dismiss control. The panel is advisory only: it never blocks submission, and the chosen article's id is not persisted.

This is the "key moment" from the design brief — an employee hitting the answer before the ticket exists — so it must be visible without scrolling past the description field.

- [ ] **Step 2: Add the resolution-to-article action to the ticket detail page**

When `ticket.status` is `resolved` or `closed`, `ticket.resolutionNote` is non-empty, and `hasAnyPermission(['kb:author'])`, render a "Create knowledge article" button in the resolution section. It calls `useMutation(knowledgeApi.fromTicket)`, and on success shows a confirmation linking to `/knowledge/:id`. On error, surface `apiErrorMessage` — the `RESOLUTION_NOTE_REQUIRED` case must read as a clear message, not a generic failure.

- [ ] **Step 3: Add the Articles group to `GlobalSearch.tsx`**

Two edits that must both happen or the group is invisible:

1. Extend `hasResults` to include `(resultsQuery.data?.articles.length ?? 0)` — otherwise an articles-only result set renders "No matches" while results exist.
2. Render an "Articles" group between Tickets and People, each row a `<button>` that closes the panel and navigates to `/knowledge/${a.id}`, mirroring `openTicket`.

Also change the placeholder from `Search tickets…` to `Search tickets and articles…`.

- [ ] **Step 4: Verify the integration in the browser**

As `employee@demo.local`, start a new ticket titled "cannot connect to wifi" and confirm the suggestion panel appears. As a technician, open a resolved ticket, click "Create knowledge article", and confirm the draft opens in the editor.

- [ ] **Step 5: Verify it compiles**

Run: `npm run typecheck -w client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/TicketCreatePage.tsx client/src/pages/TicketDetailPage.tsx client/src/components/GlobalSearch.tsx
git commit -m "feat: surface knowledge articles during ticket creation and resolution"
```

---

### Task 13: End-to-end tests

**Files:**
- Create: `client/tests/knowledge.spec.ts`

**Interfaces:**
- Consumes: everything above, plus the demo accounts (`admin@demo.local`, `employee@demo.local`, `ChangeMe!2026`) and the seeded articles from Task 6.
- Produces: a Playwright suite covering the self-service path, the authoring path and the adversarial cases.

- [ ] **Step 1: Write the spec**

Mirror `client/tests/phase5.spec.ts`: `test.use({ storageState: 'tests/auth-state.json' })` for admin-by-default, the same inline `loginAs` helper, and `test.describe` blocks per area.

Self-service:
- `it('employee finds an article from the knowledge page')` — navigate `/knowledge`, type a seeded term, expect a result card, click it, expect the title heading and a non-empty body.
- `it('employee marks an article helpful')` — click Helpful, expect the count to increase.
- `it('article suggestions appear while typing a ticket title')` — go to `/tickets/new`, type the seeded term, expect the suggestions panel.

Authoring:
- `it('technician creates a draft, submits it and an admin publishes it')` — the full three-role path.
- `it('an admin can archive and restore a published article')`.
- `it('the article health section renders for an admin')` — visit `/admin/knowledge`, expect the totals and the "born from a resolved ticket" count to be visible.

Adversarial (a fresh `browser.newContext()` with no storage state, logged in as the demo employee):
- `it('an employee cannot reach the knowledge admin page')` — `/admin/knowledge` shows "Access denied" and does not redirect.
- `it('an employee cannot reach the article editor')` — `/knowledge/new` shows "Access denied".
- `it('a script tag in an article body renders as literal text')` — create an article whose body contains `<script>alert(1)</script>` as a technician, then assert the page shows the text and that no dialog fired.
- `it('a search term of only wildcards returns the empty state')` — type `%%` into the knowledge search and expect the empty-state message, not an error.

- [ ] **Step 2: Run the suite**

Run: from `client/`, `npx playwright test tests/knowledge.spec.ts`
Expected: PASS. The API server must already be running on port 5000 (Playwright's `webServer` only starts the Vite client on 5173, which proxies `/api` to 5000).

- [ ] **Step 3: Run the whole server suite to check for regressions**

Run: `npm run test -w server`
Expected: PASS — the search and service-management specs must still be green.

- [ ] **Step 4: Commit**

```bash
git add client/tests/knowledge.spec.ts
git commit -m "test: knowledge base end-to-end coverage"
```

---

### Task 14: Update the task plan

**Files:**
- Modify: `taskplan.md`

**Interfaces:**
- Consumes: nothing.
- Produces: Phase 5's knowledge-base line marked complete with a pointer to the artifacts.

- [ ] **Step 1: Tick the line and record the evidence**

Change the Phase 5 item to checked, and append the same parenthetical style used by the neighbouring lines — naming the server module, the client pages and the test files that prove it, plus the count of integration and e2e tests now green.

- [ ] **Step 2: Commit**

```bash
git add taskplan.md
git commit -m "docs: mark Phase 5 knowledge base complete"
```

---

## Notes for the implementer

- **Every commit in this plan needs the user's approval first.** Ask before running any `git commit`, and do not add co-author trailers.
- Two decisions in this plan are mine rather than the user's, and are worth flagging when handing it over: **(a)** editing a published article returns it to `draft` pending re-approval (so unapproved content is never live, at the cost of the article leaving self-service during the edit); **(b)** article bodies render as plain text with preserved whitespace, adding no markdown dependency to a client that currently has none.
- `KnowledgeRevision` uses `onDelete: Restrict` deliberately: deleting an article with history must fail rather than silently destroy the audit trail. There is no delete-article endpoint in this plan.
- The `test` schema is truncated between tests, so a spec that asserts on generated numbers or counters must create its own fixtures first.
