# Phase 3: Workflow and Line Operations - Research

**Researched:** 2026-02-27
**Domain:** NestJS REST controller layer, RBAC enforcement, Prisma schema extension (CONTESTED state + Finance/QC fields), workflow queue patterns, line split operation
**Confidence:** HIGH (all patterns derived from existing codebase Phase 1 + Phase 2 implementations and verified NestJS/Prisma official patterns)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase boundary:** REST API controller layer only — no frontend. Phase 3 builds HTTP endpoints on top of the Phase 2 service layer. Creating the HTTP controller layer and request/response DTOs is in scope. Frontend is out of scope.

**Contest flow mechanics:**
- Contesting a REJECTED RMA introduces a new **CONTESTED** state in the state machine (REJECTED → CONTESTED)
- **Overturn:** Branch Manager overturns → RMA transitions CONTESTED → APPROVED
- **Uphold:** Branch Manager upholds → RMA transitions CONTESTED → CLOSED (final; rejection stands)
- **One contest per RMA only** — once upheld and closed, no further contesting is possible
- Both the dispute reason (from customer) and the manager's resolution note are required fields

**Approval queue scoping:**
- The Branch Manager approvals queue returns **header-level summary** per item: RMA number, submitting agent name, customer name/ID, submission date, line count, total ordered quantity
- Default sort: **oldest first** (FIFO — prevents older submissions being buried)
- If a manager oversees multiple branches: **combined queue with optional branch filter** — one endpoint, `?branchId=` filter param
- The same approvals queue endpoint returns **both SUBMITTED and CONTESTED** RMAs (manager has one place to check for pending decisions); caller can filter by status

**Finance credit approval gate:**
- Finance approval is at the **line level** — each credit-disposition line is approved individually
- The `resolve()` transition is **hard-blocked** if any credit line lacks Finance approval (all credit lines must be approved before RESOLVED)
- If a line's disposition changes away from CREDIT after Finance approved it, the Finance approval is **cleared** (approval was for the credit decision; changing disposition invalidates it)
- Finance gets a **dedicated queue endpoint** (`/finance/credit-approvals`) returning all lines with CREDIT disposition and no Finance approval, scoped to QC_COMPLETE RMAs

**Line split rules:**
- **Quantity conservation is required** — the sum of all split line quantities must equal the original line's ordered quantity exactly
- **Split lines can have different reason codes** (not just different dispositions/quantities) — full independent line definition per split
- **Minimum 2 lines** must result from a split; **no maximum**
- Line splitting is only allowed when lines are editable: **DRAFT and INFO_REQUIRED states only** (same LINE_EDITABLE_STATUSES guard as Phase 2 — no special case)
- The original line is replaced by the split lines; the original line record is removed

### Claude's Discretion

- QC inspection recording payload structure (pass/fail fields, findings text, disposition recommendation) — implement per REQUIREMENTS.md spec
- HTTP route naming conventions (stay consistent with Phase 2 patterns)
- Error response shapes for new guard violations (contest-when-not-rejected, split-quantity-mismatch, etc.)
- Pagination implementation for queue endpoints

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LINE-04 | Returns Agent can split one RMA line into multiple lines with different dispositions or quantities | Service method: `splitLine(rmaId, lineId, splits[], actor)` — validate LINE_EDITABLE_STATUSES, sum conservation, min 2 lines; delete original, createMany replacements; audit LINE_SPLIT; REST endpoint POST /rmas/:id/lines/:lineId/split |
| WKFL-01 | Branch Manager can view an approvals queue of all Submitted RMAs awaiting their decision and approve or reject from it | New repository query: findForApproval(branchIds, statusFilter?, branchFilter?); REST GET /approvals/queue with optional ?branchId= and ?status= filters; @Roles(BRANCH_MANAGER) guard; branchScopeWhere() enforces data ownership |
| WKFL-02 | Customer can contest a Rejected RMA by providing a dispute reason, transitioning it to Contested | Schema: add CONTESTED to RmaStatus enum + disputeReason/contestedAt fields on Rma; service method: `contest(rmaId, disputeReason, actor)`; state machine: REJECTED → CONTESTED; REST POST /rmas/:id/contest; @Roles(CUSTOMER) |
| WKFL-03 | Branch Manager can review a Contested RMA and either overturn (→ Approved) or uphold (→ Closed) | Service methods: `overturn(rmaId, resolutionNote, actor)` and `uphold(rmaId, resolutionNote, actor)`; state machine additions: CONTESTED → APPROVED and CONTESTED → CLOSED; REST POST /rmas/:id/overturn and /rmas/:id/uphold; @Roles(BRANCH_MANAGER) |
| WKFL-04 | Finance staff can view and approve credit-disposition lines before an RMA transitions to Resolved | Schema: add financeApprovedAt/financeApprovedById fields on RmaLine; resolve() hard-block guard for unapproved credit lines; service method: `approveLineCredit(rmaId, lineId, actor)`; REST GET /finance/credit-approvals and POST /rmas/:id/lines/:lineId/approve-credit; @Roles(FINANCE) |
| WKFL-05 | QC staff can record per-line inspection results (pass/fail, findings, disposition recommendation) on a Received RMA | Schema: add qcPass Boolean?, qcFindings String?, qcDispositionRecommendation DispositionType? fields to RmaLine; extend recordQcInspection() to accept these fields; REST POST /rmas/:id/lines/:lineId/qc-inspection; @Roles(QC) |
</phase_requirements>

---

## Summary

Phase 3 is the HTTP layer that exposes Phase 2's service methods through a REST API with full RBAC and data-ownership enforcement. It is primarily a controller and DTO phase — the service logic already exists (or will be extended with new service methods for CONTESTED state, Finance approval, and line splitting). The key deliverables are: NestJS controllers with `@UseGuards(RmsAuthGuard, RolesGuard)` and `@Roles()` decorators, Zod-validated request DTOs, two queue endpoints (Branch Manager approvals, Finance credit approvals), the contest flow state extensions, a Finance line-level approval gate, and the line split operation.

The schema must be extended with three changes: (1) add `CONTESTED` to the `RmaStatus` enum and `disputeReason`/`contestedAt`/`contestResolutionNote` fields to the `Rma` model; (2) add `financeApprovedAt`/`financeApprovedById` nullable fields to `RmaLine` for credit disposition tracking; (3) add `qcPass`/`qcFindings`/`qcDispositionRecommendation` nullable fields to `RmaLine` for structured QC results. The state machine transition map in `rma-lifecycle.ts` must be extended to include CONTESTED as a non-terminal state with two exit transitions.

The guard chain pattern from Phase 1 is the mandatory pattern for all Phase 3 controllers: `JwtAuthGuard` (global APP_GUARD — already wired) → `RmsAuthGuard` (extracts `req.rmsUser`) → `RolesGuard` (checks `@Roles()`). Data ownership is enforced via `branchScopeWhere(user)` in repository query methods. All new service methods follow the Phase 2 pattern: fetch → validate transition/guard → `prisma.$transaction(async tx => { update; auditService.logEvent(tx, ...) })`.

**Primary recommendation:** Build Phase 3 as three groups: (1) schema migration + service extensions (CONTESTED state, Finance approval gate, QC fields, line split), (2) new NestJS controllers for the RMA lifecycle actions, (3) dedicated queue controllers for the Branch Manager approval queue and Finance credit queue. Test with Vitest integration tests covering RBAC enforcement and data ownership.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @nestjs/common | ^11.0.1 | Controller, UseGuards, Post, Get, Body, Param, Query, Req decorators | Already installed; the NestJS controller pattern |
| @nestjs/core | ^11.0.1 | Reflector (for RolesGuard), APP_GUARD | Already installed; global guard wiring is in AppModule |
| prisma / @prisma/client | ^7.4.2 | Schema extension (CONTESTED, Finance, QC fields), migration | Already installed; project ORM |
| zod | ^4.3.6 | DTO validation (request body schemas) | Already installed; project validation library |
| vitest | ^4.0.18 | Integration tests (Prisma 7 ESM) | Already installed; test runner for Phase 3 |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| class-validator / class-transformer | Not installed | NestJS native DTO validation with decorators | NOT the project pattern — Zod is already installed; do not add class-validator |
| @nestjs/swagger | Not installed | OpenAPI decorators | Out of scope for Phase 3 |
| supertest | ^7.0.0 | HTTP request assertions in integration tests | Already installed; used for e2e controller tests |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zod for DTO validation | class-validator decorators | class-validator requires class-transformer and separate `@IsString()` decorators per field; Zod is already the project standard; consistent with Phase 1 config validation |
| Manual pagination | Prisma cursor pagination | Cursor pagination adds complexity; for v1 queue endpoints, offset-based with `take`/`skip` is sufficient and simpler |
| Separate Contest/Overturn/Uphold controllers | Adding methods to existing RmaController | Methods are closely related; adding to RmaController with clear action-based routes (`/rmas/:id/contest`) is simpler and consistent |

**Installation:** No new npm installs required. All required packages are already in `rms-api/package.json`.

---

## Architecture Patterns

### Recommended Project Structure

```
rms-api/src/
├── rma/
│   ├── rma.module.ts                    # add WorkflowController, FinanceController exports
│   ├── rma.service.ts                   # extend: contest, overturn, uphold, splitLine,
│   │                                    #   approveLineCredit, extend recordQcInspection
│   ├── rma.repository.ts                # extend: findForApprovalQueue, findCreditApprovalLines
│   ├── rma-lifecycle.ts                 # extend ALLOWED_TRANSITIONS with CONTESTED paths
│   ├── rma.types.ts                     # add ContestInput, SplitLineInput, QcInspectionInput
│   ├── rma.controller.ts                # NEW: CRUD + lifecycle action endpoints
│   ├── workflow.controller.ts           # NEW: approval queue + contest flow endpoints
│   ├── finance.controller.ts            # NEW: credit approval queue + line approval endpoint
│   ├── rma.controller.spec.ts           # Jest unit tests (guard/RBAC logic)
│   └── rma.service.integration.spec.ts  # Vitest integration tests (extend Phase 2 file)
│   └── workflow.integration.spec.ts     # Vitest integration tests (Phase 3 requirements)
├── audit/                               # (existing Phase 1 — no changes)
├── auth/                                # (existing Phase 1 — no changes)
├── prisma/                              # (existing Phase 1 — no changes)
└── users/                               # (existing Phase 1 — no changes)
```

### Pattern 1: NestJS Controller with Two-Step Guard Chain

**What:** Every Phase 3 controller method uses `@UseGuards(RmsAuthGuard, RolesGuard)` at the class level and `@Roles('ROLE_NAME')` at the method level (or class level when all methods share the same role).
**When to use:** All Phase 3 controller methods — no unprotected endpoints.

```typescript
// Source: Phase 1 guard implementations in src/auth/
// JwtAuthGuard is already applied globally as APP_GUARD in AppModule.
// RmsAuthGuard + RolesGuard are applied per-controller.

import { Controller, Post, Get, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { RmsAuthGuard } from '../auth/rms-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RmaService } from './rma.service.js';
import type { RmsUserContext } from '../users/users.service.js';

@Controller('rmas')
@UseGuards(RmsAuthGuard, RolesGuard)
export class RmaController {
  constructor(@Inject(RmaService) private readonly rmaService: RmaService) {}

  @Post(':id/approve')
  @Roles('BRANCH_MANAGER')
  async approve(
    @Param('id') id: string,
    @Req() req: { rmsUser: RmsUserContext },
  ) {
    // Branch-scope ownership enforced inside service via branchScopeWhere()
    return this.rmaService.approve(id, req.rmsUser);
  }
}
```

### Pattern 2: Zod-Validated Request Body

**What:** Parse and validate request bodies with a Zod schema before passing to the service. Throw `BadRequestException` with the Zod error details on parse failure.
**When to use:** All POST/PATCH endpoints that accept a request body.

```typescript
// Source: Zod docs (https://zod.dev) + existing project pattern (config.schema.ts)
// ValidationPipe (whitelist: true) is already applied globally in main.ts.
// For Zod validation in controllers, parse manually (no class-validator).

import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';

const ContestInput = z.object({
  disputeReason: z.string().min(1, 'Dispute reason is required'),
});

@Post(':id/contest')
@Roles('CUSTOMER')
async contest(
  @Param('id') id: string,
  @Body() body: unknown,
  @Req() req: { rmsUser: RmsUserContext },
) {
  const result = ContestInput.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }
  return this.rmaService.contest(id, result.data, req.rmsUser);
}
```

### Pattern 3: State Machine Extension for CONTESTED

**What:** Extend `ALLOWED_TRANSITIONS` in `rma-lifecycle.ts` to add CONTESTED as a new non-terminal state with two exit paths. Also update the TypeScript exhaustiveness check to include CONTESTED.
**When to use:** Required for WKFL-02 and WKFL-03.

```typescript
// Source: existing rma-lifecycle.ts (Phase 2); extend in-place

export const ALLOWED_TRANSITIONS: Readonly<Record<RmaStatus, readonly RmaStatus[]>> = {
  [RmaStatus.DRAFT]:         [RmaStatus.SUBMITTED, RmaStatus.CANCELLED],
  [RmaStatus.SUBMITTED]:     [RmaStatus.APPROVED, RmaStatus.REJECTED, RmaStatus.INFO_REQUIRED, RmaStatus.CANCELLED],
  [RmaStatus.INFO_REQUIRED]: [RmaStatus.SUBMITTED, RmaStatus.CANCELLED],
  [RmaStatus.APPROVED]:      [RmaStatus.RECEIVED, RmaStatus.CANCELLED],
  [RmaStatus.RECEIVED]:      [RmaStatus.QC_COMPLETE],
  [RmaStatus.QC_COMPLETE]:   [RmaStatus.RESOLVED],
  [RmaStatus.RESOLVED]:      [RmaStatus.CLOSED],
  // NEW in Phase 3:
  [RmaStatus.CONTESTED]:     [RmaStatus.APPROVED, RmaStatus.CLOSED], // overturn | uphold
  // Terminal (unchanged):
  [RmaStatus.REJECTED]:      [],
  [RmaStatus.CANCELLED]:     [],
  [RmaStatus.CLOSED]:        [],
} as const;
```

### Pattern 4: Approval Queue Repository Query

**What:** A repository method that returns the Branch Manager approval queue — SUBMITTED and CONTESTED RMAs belonging to the manager's branches, sorted oldest-first, with optional branchId and status filters.
**When to use:** WKFL-01, backing the GET /approvals/queue endpoint.

```typescript
// Source: Prisma findMany with where/orderBy/select (https://www.prisma.io/docs/orm/prisma-client/queries/crud)
// branchScopeWhere() is from Phase 1 (users.service.ts) — the mandatory ownership filter

async findForApprovalQueue(
  tx: Prisma.TransactionClient | PrismaService,
  user: RmsUserContext,
  options?: { branchId?: string; status?: RmaStatus; take?: number; skip?: number },
): Promise<ApprovalQueueItem[]> {
  const statusFilter = options?.status
    ? [options.status]
    : [RmaStatus.SUBMITTED, RmaStatus.CONTESTED];

  const branchFilter = options?.branchId
    ? { branchId: options.branchId }          // specific branch override
    : branchScopeWhere(user);                 // all assigned branches (ownership enforcement)

  return tx.rma.findMany({
    where: {
      ...branchFilter,
      status: { in: statusFilter },
    },
    orderBy: { createdAt: 'asc' },             // oldest first (FIFO)
    take: options?.take ?? 50,
    skip: options?.skip ?? 0,
    select: {
      id: true,
      rmaNumber: true,
      status: true,
      createdAt: true,
      customerId: true,
      submittedBy: { select: { displayName: true, email: true } },
      _count: { select: { lines: true } },
      lines: { select: { orderedQty: true } },
    },
  });
}
```

### Pattern 5: Finance Resolve Guard

**What:** In `RmaService.resolve()`, before transitioning to RESOLVED, check that all lines with `CREDIT` disposition have `financeApprovedAt` set. Hard-block the transition if any credit line is unapproved.
**When to use:** WKFL-04 — extends the existing `resolve()` method in rma.service.ts.

```typescript
// Extend the existing resolve() in rma.service.ts — add this guard before $transaction():

const unapprovedCreditLines = rma.lines.filter(
  (l) => l.disposition === DispositionType.CREDIT && l.financeApprovedAt === null
);
if (unapprovedCreditLines.length > 0) {
  throw new BadRequestException(
    `Cannot resolve — ${unapprovedCreditLines.length} credit line(s) awaiting Finance approval`
  );
}
```

### Pattern 6: Line Split Service Method

**What:** A transactional operation that validates sum conservation and minimum line count, deletes the original line, and creates the replacement lines inside a single transaction.
**When to use:** LINE-04 — `RmaService.splitLine()`.

```typescript
// Source: Prisma deleteMany + createMany pattern; Phase 2 transaction pattern

async splitLine(
  rmaId: string,
  lineId: string,
  splits: SplitLineInput[],
  actor: RmaActorContext,
): Promise<RmaWithLines> {
  // Guard: minimum 2 lines
  if (splits.length < 2) {
    throw new BadRequestException('Split must produce at least 2 lines');
  }

  const rma = await this.rmaRepository.findById(rmaId);
  if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

  // Guard: LINE_EDITABLE_STATUSES (same as addLine/updateLine/removeLine)
  if (!LINE_EDITABLE_STATUSES.includes(rma.status)) {
    throw new BadRequestException(
      `Cannot split lines on an RMA in ${rma.status} status — lines are locked after submission`
    );
  }

  const line = rma.lines.find((l) => l.id === lineId);
  if (!line) throw new NotFoundException(`Line ${lineId} not found on RMA ${rmaId}`);

  // Guard: quantity conservation
  const totalSplitQty = splits.reduce((sum, s) => sum + s.orderedQty, 0);
  if (totalSplitQty !== line.orderedQty) {
    throw new BadRequestException(
      `Split quantities must sum to ${line.orderedQty} (original ordered qty); got ${totalSplitQty}`
    );
  }

  return this.prisma.$transaction(async (tx) => {
    // Remove original line
    await tx.rmaLine.delete({ where: { id: lineId } });

    // Create replacement lines
    await tx.rmaLine.createMany({
      data: splits.map((s) => ({
        rmaId,
        partNumber: s.partNumber,
        orderedQty: s.orderedQty,
        reasonCode: s.reasonCode,
        disposition: (s.disposition as any) ?? null,
        receivedQty: 0,
        inspectedQty: 0,
      })),
    });

    await this.auditService.logEvent(tx, {
      rmaId,
      rmaLineId: lineId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AuditAction.LINE_SPLIT,
      oldValue: { partNumber: line.partNumber, orderedQty: line.orderedQty, splitInto: splits.length },
      newValue: { splitLines: splits.map((s) => ({ partNumber: s.partNumber, orderedQty: s.orderedQty })) },
    });

    return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
  });
}
```

### Anti-Patterns to Avoid

- **Missing `@Inject()` on controller constructor parameters:** Same esbuild constraint from Phase 1 — all `@Injectable()` class constructors require `@Inject(Token)` on every parameter.
- **Applying RmsAuthGuard globally instead of per-controller:** JwtAuthGuard is already the global APP_GUARD. RmsAuthGuard and RolesGuard are applied per-controller with `@UseGuards()`. Do not add RmsAuthGuard to AppModule.providers.
- **Using `this.prisma` (not `tx`) inside service transaction callbacks:** All repository calls inside a `prisma.$transaction(async tx => {...})` must use `tx`, not `this.prisma`. Repository methods already accept `tx: Prisma.TransactionClient`.
- **Branch filter missing from approval queue:** The queue MUST use `branchScopeWhere(user)` as the base filter — never return all SUBMITTED RMAs globally. Admin bypass is already handled inside `branchScopeWhere`.
- **Letting Finance approval persist when disposition changes to non-CREDIT:** When `updateLine()` sets a new disposition that is not CREDIT, the service must clear `financeApprovedAt` and `financeApprovedById` in the same update.
- **Adding class-validator/class-transformer:** Not the project pattern. Use Zod's `safeParse` in controller methods. The global `ValidationPipe` handles `class-validator`-annotated DTOs but Zod is the project standard.
- **Adding CONTESTED to ALLOWED_TRANSITIONS terminal array:** CONTESTED is a non-terminal state with two exit paths. It must not be in the empty-array terminal group.
- **"One contest per RMA" enforced only in state machine:** The state machine prevents re-contesting a CLOSED RMA (no transitions out), but the service should explicitly check `contestedAt IS NOT NULL` before allowing a contest transition from REJECTED — a REJECTED RMA that was never contested should be contestable once, and a REJECTED-then-UPHELD→CLOSED RMA is already blocked by the transition map. The explicit check is for the "one contest" rule when an RMA is in REJECTED status but has already been contested and overturned back to APPROVED (edge case: the RMA may be APPROVED again but has `contestedAt` set). However, since CONTESTED → APPROVED (overturn) takes the RMA out of the REJECTED state permanently, re-contesting is only possible if the RMA is later rejected again — which the context says is not possible after an overturn. The service check is: before `contest()`, verify `rma.contestedAt === null`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request body validation | Manual `if (!body.reason)` guards | Zod `safeParse` with `z.object()` schemas | Consistent with Phase 1 config validation; catches type coercion issues; produces structured error messages |
| Data ownership filtering | Custom `WHERE branchId = user.branchId` SQL per query | `branchScopeWhere(user)` from `users.service.ts` | Already implemented and tested in Phase 1; Admin bypass is built-in |
| State transition validation | `if (rma.status !== 'SUBMITTED') throw...` per method | `assertValidTransition(from, to)` from `rma-lifecycle.ts` | Already implemented in Phase 2; centralized; tested |
| Atomic audit writes | Separate audit write after the main write | `auditService.logEvent(tx, ...)` inside `prisma.$transaction()` | Already the project pattern; breaking it violates FOUND-04 |
| Finance approval queue | Custom SQL aggregating credit lines | Prisma `findMany` with `where: { disposition: 'CREDIT', financeApprovedAt: null, rma: { status: 'QC_COMPLETE' } }` | Prisma relation filters handle nested conditions cleanly |
| Pagination | Custom cursor logic | Prisma `take`/`skip` with total count via `$transaction([findMany, count])` | Prisma batch transactions handle read+count in one round-trip |

**Key insight:** Phase 3 is almost entirely wiring — the service layer already handles most business logic. The controller's job is to authenticate, authorize, parse the body, call the service, and return the result. Keep controllers thin.

---

## Common Pitfalls

### Pitfall 1: Missing @Inject() on Controller Constructor (esbuild constraint)

**What goes wrong:** Controller works with `nest start` but throws "Cannot read properties of undefined" in Vitest integration tests because `this.rmaService` is undefined.
**Why it happens:** esbuild (Vitest's bundler) does not emit `design:paramtypes`. NestJS cannot infer the injection token without it.
**How to avoid:** All controller constructors MUST use `@Inject(RmaService)` explicitly. Same rule established in Phase 1 and Phase 2 for all @Injectable() classes.
**Warning signs:** "Cannot read properties of undefined (reading 'approve')" in test output.

### Pitfall 2: CONTESTED Not Added to Schema Migration

**What goes wrong:** Runtime error "Invalid value for argument `status`" when the service tries to write `RmaStatus.CONTESTED` — the DB does not know this enum value.
**Why it happens:** Adding CONTESTED to TypeScript (the `rma-lifecycle.ts` transition map) without also adding it to the Prisma schema enum and running a migration.
**How to avoid:** The schema change (`CONTESTED` in the `RmaStatus` enum) and migration must be done before writing any service code that uses `RmaStatus.CONTESTED`. Order: schema → migration → service extension.
**Warning signs:** Prisma validation error at runtime or compile-time "Property 'CONTESTED' does not exist on type 'typeof RmaStatus'".

### Pitfall 3: Finance Approval Not Cleared on Disposition Change

**What goes wrong:** A Finance user approves a CREDIT line. A Returns Agent later changes the disposition to SCRAP. The RMA resolves without Finance re-approving — the approval was for a credit that no longer applies.
**Why it happens:** `updateLine()` in the service only updates the fields specified in `UpdateLineInput`. If the Finance approval clearing is not explicit, it silently persists.
**How to avoid:** In `RmaService.updateLine()`, when `data.disposition` is set to a non-CREDIT value (or to `null`), also set `financeApprovedAt: null` and `financeApprovedById: null` in the same repository update call.
**Warning signs:** Resolved RMAs with SCRAP/REPLACEMENT/RTV lines that have `financeApprovedAt` set.

### Pitfall 4: Approval Queue Returning Cross-Branch RMAs

**What goes wrong:** A Branch Manager at Branch A can see RMAs from Branch B in the approvals queue.
**Why it happens:** Forgetting to apply `branchScopeWhere(user)` in the repository query, or applying it but not accounting for the `?branchId=` override correctly (the override must be validated against the user's own branches).
**How to avoid:** Always build the branch filter from `branchScopeWhere(user)` as the base. If a `?branchId=` filter param is provided, validate that `branchId` is in `user.branchIds` before using it as a narrowing filter — otherwise a manager could enumerate RMAs from branches they don't manage.
**Warning signs:** Integration test where user with branchIds: ['branch-A'] receives RMAs from 'branch-B' in the queue response.

### Pitfall 5: Line Split Without Prisma createMany Return Shape

**What goes wrong:** `tx.rmaLine.createMany()` returns `{ count: N }`, not the created records. After the split, the service calls `rmaRepository.findById(rmaId)` to return the updated RMA — this is correct and necessary. Do not try to return the createMany result directly.
**Why it happens:** Developers expect `createMany` to return records like `create` does. In Prisma, `createMany` only returns a count.
**How to avoid:** Always call `rmaRepository.findById(rmaId)` at the end of the split transaction to fetch the updated RMA with new lines. This is the existing pattern in all Phase 2 service methods.
**Warning signs:** Attempting `return tx.rmaLine.createMany(...)` and getting `{ count: 2 }` as the response instead of an RmaWithLines object.

### Pitfall 6: Controller Returning Internal Fields to Customer Role

**What goes wrong:** A Customer-role user calls an RMA detail endpoint and sees internal fields (rejectionReason, auditEvents with internal metadata, etc.) that should be staff-only.
**Why it happens:** Controller returns the full Prisma entity without role-scoped field filtering.
**How to avoid:** Phase 3 is backend-only — for now, define separate response DTO types that exclude sensitive fields, and use Prisma `select` to not fetch them for Customer-role requests. At minimum, document which fields require filtering and address it in Phase 6 (Customer Portal).
**Warning signs:** API response includes `rejectionReason` when called with a Customer JWT.

### Pitfall 7: "One contest per RMA" Not Enforced at Service Layer

**What goes wrong:** A customer calls `POST /rmas/:id/contest` on an already-contested-and-overturned RMA that was later returned to SUBMITTED status and re-rejected. Since REJECTED is a valid from-state for `contest()`, the state machine allows it — but the business rule says one contest only.
**Why it happens:** The state machine only knows current status. It does not know history. The "one contest only" rule is a historical constraint.
**How to avoid:** Before calling `assertValidTransition(rma.status, CONTESTED)` in the `contest()` method, check `if (rma.contestedAt !== null) throw new BadRequestException(...)`. This requires `contestedAt` to be a non-nullable timestamp once set and never cleared.
**Warning signs:** STATE.md explicitly calls this out: "One contest per RMA is enforced at the service layer, not just the state machine."

---

## Code Examples

Verified patterns from existing codebase and official sources:

### Schema Extension — CONTESTED State + Finance + QC Fields

```prisma
// Extend rms-api/prisma/schema.prisma
// Source: existing schema.prisma (Phase 1 + Phase 2) — same patterns

enum RmaStatus {
  DRAFT
  SUBMITTED
  INFO_REQUIRED
  APPROVED
  RECEIVED
  QC_COMPLETE
  RESOLVED
  CLOSED
  REJECTED
  CANCELLED
  CONTESTED          // NEW: Phase 3 — between REJECTED and resolution
}

// Add to Rma model:
model Rma {
  // ... existing fields ...
  disputeReason         String?    // set when customer contests; required for CONTESTED
  contestedAt           DateTime?  // set on first contest; checked for "one contest" rule
  contestResolutionNote String?    // Branch Manager's documented note on overturn or uphold

  // ... existing relations ...
}

// Add to RmaLine model:
model RmaLine {
  // ... existing fields ...
  financeApprovedAt     DateTime?  // set when Finance approves a CREDIT disposition line
  financeApprovedById   String?    // FK: User.id of the Finance approver
  qcPass                Boolean?   // true = pass, false = fail, null = not yet recorded
  qcFindings            String?    // free-text inspection notes (structured QC result)
  qcDispositionRecommendation DispositionType?  // QC staff recommendation

  // ... existing relations ...
}
```

### Contest Flow Service Methods

```typescript
// Source: Phase 2 RmaService pattern (rma.service.ts)
// All three methods follow the Phase 2 pattern: fetch → validate → $transaction

// WKFL-02: Customer contests a REJECTED RMA
async contest(
  rmaId: string,
  input: ContestInput,
  actor: RmaActorContext,
): Promise<RmaWithLines> {
  if (!input.disputeReason || input.disputeReason.trim().length === 0) {
    throw new BadRequestException('Dispute reason is required');
  }

  const rma = await this.rmaRepository.findById(rmaId);
  if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

  // "One contest per RMA" — service-layer rule (not just state machine)
  if (rma.contestedAt !== null) {
    throw new BadRequestException('This RMA has already been contested once and cannot be contested again');
  }

  assertValidTransition(rma.status, RmaStatus.CONTESTED);

  return this.prisma.$transaction(async (tx) => {
    await this.rmaRepository.updateRma(tx, rmaId, {
      status: RmaStatus.CONTESTED,
      disputeReason: input.disputeReason.trim(),
      contestedAt: new Date(),
    });

    await this.auditService.logEvent(tx, {
      rmaId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AuditAction.RMA_CONTESTED,
      fromStatus: rma.status,
      toStatus: RmaStatus.CONTESTED,
      newValue: { disputeReason: input.disputeReason.trim() },
    });

    return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
  });
}

// WKFL-03: Branch Manager overturns — CONTESTED → APPROVED
async overturn(
  rmaId: string,
  input: { resolutionNote: string },
  actor: RmaActorContext,
): Promise<RmaWithLines> {
  if (!input.resolutionNote || input.resolutionNote.trim().length === 0) {
    throw new BadRequestException('Resolution note is required');
  }

  const rma = await this.rmaRepository.findById(rmaId);
  if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

  assertValidTransition(rma.status, RmaStatus.APPROVED);

  return this.prisma.$transaction(async (tx) => {
    await this.rmaRepository.updateRma(tx, rmaId, {
      status: RmaStatus.APPROVED,
      contestResolutionNote: input.resolutionNote.trim(),
    });

    await this.auditService.logEvent(tx, {
      rmaId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AuditAction.RMA_APPROVED,
      fromStatus: rma.status,
      toStatus: RmaStatus.APPROVED,
      newValue: { resolutionNote: input.resolutionNote.trim(), overturned: true },
    });

    return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
  });
}
```

### Finance Credit Approval Line Method

```typescript
// Source: Phase 2 transaction + audit pattern

async approveLineCredit(
  rmaId: string,
  lineId: string,
  actor: RmaActorContext,
): Promise<RmaWithLines> {
  const rma = await this.rmaRepository.findById(rmaId);
  if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

  const line = rma.lines.find((l) => l.id === lineId);
  if (!line) throw new NotFoundException(`Line ${lineId} not found on RMA ${rmaId}`);

  if (line.disposition !== DispositionType.CREDIT) {
    throw new BadRequestException(`Line ${lineId} does not have a CREDIT disposition`);
  }

  if (line.financeApprovedAt !== null) {
    throw new BadRequestException(`Line ${lineId} is already Finance-approved`);
  }

  return this.prisma.$transaction(async (tx) => {
    await tx.rmaLine.update({
      where: { id: lineId },
      data: {
        financeApprovedAt: new Date(),
        financeApprovedById: actor.id,
      },
    });

    await this.auditService.logEvent(tx, {
      rmaId,
      rmaLineId: lineId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AuditAction.DISPOSITION_SET,
      newValue: { financeApproved: true, financeApprovedBy: actor.id },
    });

    return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
  });
}
```

### Workflow Controller (Approval Queue)

```typescript
// Source: NestJS controller docs (https://docs.nestjs.com/controllers)
// + Phase 1 guard patterns (rms-auth.guard.ts, roles.guard.ts, roles.decorator.ts)

import {
  Controller, Get, Post, Param, Body, Query, Req, UseGuards, Inject
} from '@nestjs/common';
import { RmsAuthGuard } from '../auth/rms-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RmaService } from './rma.service.js';
import type { RmsUserContext } from '../users/users.service.js';

@Controller()
@UseGuards(RmsAuthGuard, RolesGuard)
export class WorkflowController {
  constructor(@Inject(RmaService) private readonly rmaService: RmaService) {}

  // WKFL-01: Branch Manager approval queue
  @Get('approvals/queue')
  @Roles('BRANCH_MANAGER')
  async getApprovalQueue(
    @Req() req: { rmsUser: RmsUserContext },
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.rmaService.getApprovalQueue(req.rmsUser, {
      branchId,
      status: status as any,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  // WKFL-02: Customer contests a REJECTED RMA
  @Post('rmas/:id/contest')
  @Roles('CUSTOMER')
  async contest(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: { rmsUser: RmsUserContext },
  ) {
    const result = z.object({
      disputeReason: z.string().min(1),
    }).safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.contest(id, result.data, req.rmsUser);
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Implicit @Inject() in NestJS | Explicit `@Inject(Token)` on all constructor params | Phase 1 discovery | Required permanently due to esbuild/Vitest not emitting design:paramtypes |
| class-validator for DTOs | Zod `safeParse` in controller | Project decision at Phase 1 | Zod is already the project validation library; no new dependency needed |
| Jest for all NestJS tests | Jest (unit) + Vitest (integration) dual runner | Prisma 7 ESM change | Vitest required for integration tests touching real Prisma 7 client |
| Global route guards | Per-controller `@UseGuards()` for RmsAuthGuard | Phase 1 architecture | JwtAuthGuard is global; RmsAuthGuard+RolesGuard are per-controller for flexibility |

**Deprecated/outdated:**
- Implicit role inference from JWT claims: Role comes exclusively from `user_branch_roles` DB lookup (LOCKED decision from Phase 1 STATE.md). Do not read role from JWT payload.
- `class-validator` decorators: Not used in this project. All validation is Zod-based.

---

## Open Questions

1. **QC Inspection Response: Full WKFL-05 Payload**
   - What we know: REQUIREMENTS.md says "pass/fail, findings, disposition recommendation"; CONTEXT.md defers payload structure to Claude's discretion
   - What's unclear: Should `qcPass` be a required field or optional (can QC record findings without a verdict)?
   - Recommendation: Make `qcPass` optional (`Boolean?` in schema) — QC staff may record findings progressively. The `inspectedQty` field (Phase 2) remains the quantity tracker. `qcPass`, `qcFindings`, and `qcDispositionRecommendation` are all optional per-line annotations.

2. **Pagination Style for Queue Endpoints**
   - What we know: Queue endpoints need pagination; CONTEXT.md gives Claude discretion
   - What's unclear: Cursor-based vs. offset-based
   - Recommendation: Use offset-based pagination (`?take=50&skip=0`) for v1 queue endpoints. The datasets (pending approval queues) are small in practice. Prisma `take`/`skip` is simple and well-supported. Add `total` count in the response envelope: `{ data: [...], total: N, take: 50, skip: 0 }`.

3. **Finance Approval Queue: RMA Status Scope**
   - What we know: CONTEXT.md says "scoped to QC_COMPLETE RMAs" for the Finance queue
   - What's unclear: Should Finance also see lines on RESOLVED RMAs that were approved? Or strictly pending approval only?
   - Recommendation: The Finance queue (`/finance/credit-approvals`) shows only lines with `disposition = CREDIT`, `financeApprovedAt IS NULL`, on RMAs with `status = QC_COMPLETE`. Approved lines are not shown — Finance's queue is an action queue, not a history view.

4. **Branch Ownership Check for Line Operations**
   - What we know: `branchScopeWhere()` is the data-ownership filter; Phase 2 service does not include it in service methods (controllers will handle it in Phase 3)
   - What's unclear: Should service methods receive the actor's branchIds and filter in the service, or should controllers pre-validate ownership?
   - Recommendation: Keep the current Phase 2 pattern — service methods find by `rmaId` and throw `NotFoundException` if not found (which is what happens when the branch filter would exclude the record). Add an explicit branch check inside service methods for the Phase 3 additions by doing: `if (!user.isAdmin && rma.branchId && !user.branchIds.includes(rma.branchId)) throw new NotFoundException(...)`. This gives 404 (not 403) to prevent enumeration — consistent with FOUND-03.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30 (unit) + Vitest 4.0.18 (integration) |
| Config file | `rms-api/package.json` (jest config block) + `rms-api/vitest.integration.config.ts` |
| Quick run command | `cd rms-api && npm test -- --testPathPattern=rma` |
| Full suite command | `cd rms-api && npm run test:all` |
| Integration run command | `cd rms-api && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LINE-04 | Split line: sum conservation, min 2, original replaced, audit LINE_SPLIT | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| WKFL-01 | Approval queue: only own-branch SUBMITTED/CONTESTED; oldest first; branchId filter works | integration | `npm run test:e2e` | No — Wave 0 |
| WKFL-02 | Customer contests REJECTED; CONTESTED state; disputeReason stored; one-contest-only guard | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| WKFL-03 | Overturn → APPROVED; uphold → CLOSED; resolutionNote required; CONTESTED → {APPROVED,CLOSED} | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| WKFL-04 | Finance approves line; resolve() blocked without approval; approval cleared on disposition change | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| WKFL-05 | QC records pass/fail/findings/recommendation per line; stored on RmaLine | integration | `npm run test:e2e` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `cd rms-api && npm test -- --testPathPattern=rma` (unit tests only, ~5s)
- **Per wave merge:** `cd rms-api && npm run test:all` (unit + integration)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `rms-api/src/rma/workflow.integration.spec.ts` — Vitest integration tests covering LINE-04, WKFL-01 through WKFL-05
- [ ] Prisma migration: `CONTESTED` enum value + `disputeReason`/`contestedAt`/`contestResolutionNote` on Rma model + `financeApprovedAt`/`financeApprovedById`/`qcPass`/`qcFindings`/`qcDispositionRecommendation` on RmaLine model

No framework installation needed — Jest 30 and Vitest 4 are already installed and configured.

---

## Sources

### Primary (HIGH confidence)

- Project codebase (Phase 1): `rms-api/src/auth/rms-auth.guard.ts` — two-step guard chain; `req.rmsUser` attachment pattern
- Project codebase (Phase 1): `rms-api/src/auth/roles.guard.ts` + `roles.decorator.ts` — `@Roles()` + `RolesGuard` pattern; Admin bypass
- Project codebase (Phase 1): `rms-api/src/users/users.service.ts` — `branchScopeWhere()` function; `RmsUserContext` type
- Project codebase (Phase 1): `rms-api/src/audit/audit.types.ts` — `AuditAction.LINE_SPLIT`, `AuditAction.RMA_CONTESTED` already defined (pre-stubbed)
- Project codebase (Phase 2): `rms-api/src/rma/rma-lifecycle.ts` — `ALLOWED_TRANSITIONS`, `assertValidTransition()` — extend in-place
- Project codebase (Phase 2): `rms-api/src/rma/rma.service.ts` — all lifecycle method patterns; transaction + audit structure to follow
- Project codebase (Phase 2): `rms-api/src/rma/rma.repository.ts` — `RmaWithLines` type; repository method patterns (tx parameter)
- Project codebase (Phase 2): `rms-api/src/rma/rma.types.ts` — existing input types; extend with `ContestInput`, `SplitLineInput`, `QcInspectionExtendedInput`
- Project codebase: `rms-api/prisma/schema.prisma` — existing schema to extend for CONTESTED, Finance, and QC fields
- Project codebase: `rms-api/src/app.module.ts` — confirms JwtAuthGuard is APP_GUARD; RmsAuthGuard must be per-controller
- Project state: `.planning/STATE.md` — esbuild `@Inject(Token)` constraint; multi-module import requirement; `branchScopeWhere()` as the mandatory ownership filter

### Secondary (MEDIUM confidence)

- NestJS official docs — https://docs.nestjs.com/controllers — controller decorators, `@UseGuards`, `@Req`, `@Param`, `@Query`, `@Body`
- NestJS official docs — https://docs.nestjs.com/guards — guard chain order, `canActivate`, `ExecutionContext`
- Prisma official docs — https://www.prisma.io/docs/orm/prisma-client/queries/crud — `findMany` with nested where, `select` for projection, `take`/`skip` for pagination
- Prisma official docs — `createMany` return type `{ count: N }` — confirmed in Prisma CRUD reference

### Tertiary (LOW confidence)

- None — all findings are derived from the project codebase and official NestJS/Prisma documentation.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed; zero new dependencies; confirmed from package.json
- Schema extension: HIGH — follows exact same patterns as Phase 1/Phase 2 schema; Prisma enum and nullable field additions are well-established
- Controller/guard pattern: HIGH — Phase 1 implemented and tested these exact guard classes; reusing them is confirmed correct
- State machine extension: HIGH — `ALLOWED_TRANSITIONS` object is already the authoritative source; adding CONTESTED as a new key follows the established pattern
- Finance approval gate: HIGH — pattern derived directly from Phase 2 `resolve()` method guard structure
- Line split operation: HIGH — Prisma `createMany` + `delete` in a transaction is standard; return-via-findById pattern is already established
- Pitfalls: HIGH — all derived from STATE.md project history (Phases 1 and 2) and schema/code analysis

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (30 days — NestJS 11, Prisma 7, and Vitest 4 patterns are stable; esbuild @Inject constraint is permanent until test infrastructure changes)
