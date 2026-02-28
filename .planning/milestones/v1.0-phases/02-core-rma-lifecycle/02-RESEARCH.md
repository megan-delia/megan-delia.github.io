# Phase 2: Core RMA Lifecycle - Research

**Researched:** 2026-02-27
**Domain:** NestJS service layer, finite state machine (no external library), Prisma schema extension, atomic transaction + audit pattern
**Confidence:** HIGH (all core patterns verified against official Prisma docs, existing codebase patterns, and multiple cross-referenced sources)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase boundary:** Service layer + state machine only. No REST API or controllers in this phase. Phase 3 builds the API on top of this.

**Invalid Transition Behavior:**
- Rejection reason is required (same policy as cancellation per LCYC-11) — Branch Manager cannot reject without a documented reason
- Error shape, whether to enumerate valid transitions in the error response, and enforcement layer (service vs DB constraint) are Claude's discretion

**Partial Receipt and RMA State:**
- RMA transitions to Received immediately on first receipt entry — any warehouse log on any line triggers the transition
- Warehouse can continue updating received quantities while the RMA is in Received status (goods arrive over multiple days); receipt is not locked on first transition
- Over-receipt is allowed — received quantity may exceed the ordered quantity per line (over-shipment happens; just track it)
- QC-inspected quantity is capped at received quantity per line — service rejects any entry that would push inspected qty above received qty

**Info Required Response Mechanism:**
- Line items are fully editable while in Info Required — the submitter (agent or customer) can update quantities, reason codes, and dispositions before responding
- No cycle limit — an RMA can move through Info Required → Submitted → Info Required indefinitely; audit trail captures every cycle
- Info Required is cancellable — a Returns Agent can cancel an RMA in Info Required status (extends LCYC-11 coverage beyond Draft/Submitted/Approved)
- The exact mechanism that triggers the transition back to Submitted (dedicated action vs. note) is Claude's discretion

**Disposition Assignment Timing:**
- Disposition (credit / replacement / scrap / RTV) can be set at Draft creation and updated at any point until QC inspection — not locked at submission
- Disposition is optional at submission — a line may be submitted with no disposition set; Finance and QC will determine it
- Locked after QC inspection — once QC records inspection on a line, its disposition is frozen; only an Admin can override in exceptional cases
- Lines are fully editable in Draft and Info Required (add, edit, remove); submitting the RMA locks the line set from that point forward

### Claude's Discretion

- Invalid transition error shape and whether to enumerate allowed transitions in the error response
- Whether to add a DB-layer constraint in addition to service-layer enforcement
- The specific action/mechanism that triggers resubmission from Info Required (dedicated endpoint vs. implicit on any update)
- RMA number generation format

### Deferred Ideas (OUT OF SCOPE)

- None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LCYC-01 | Returns Agent can create a new RMA in Draft status | Schema: Rma model with DRAFT status; RmaService.createDraft() with nested line items; audit logEvent(tx) in same transaction |
| LCYC-02 | Returns Agent or Customer can submit a Draft RMA, transitioning it to Submitted | State machine: DRAFT → SUBMITTED; guard: lines not empty; RmaService.submit(); audit RMA_SUBMITTED |
| LCYC-03 | Branch Manager can approve a Submitted RMA, transitioning it to Approved | State machine: SUBMITTED → APPROVED; RmaService.approve(); audit RMA_APPROVED |
| LCYC-04 | Branch Manager can reject a Submitted RMA with a required reason, transitioning it to Rejected | State machine: SUBMITTED → REJECTED; guard: reason is non-empty string; audit RMA_REJECTED |
| LCYC-05 | Returns Agent can place an RMA in Info Required status | State machine: SUBMITTED → INFO_REQUIRED; audit RMA_INFO_REQUIRED |
| LCYC-06 | Customer or staff can respond to Info Required, returning to Submitted | State machine: INFO_REQUIRED → SUBMITTED; RmaService.resubmit(); audit RMA_SUBMITTED |
| LCYC-07 | Warehouse staff can record physical receipt on an Approved RMA, transitioning it to Received | State machine: APPROVED → RECEIVED on first receipt log; RmaLine receivedQty integer update; audit RMA_RECEIVED |
| LCYC-08 | QC staff can complete inspection on a Received RMA, transitioning it to QC status | State machine: RECEIVED → QC_COMPLETE; RmaService.recordQcInspection(); guard: inspected qty ≤ received qty; audit |
| LCYC-09 | Returns Agent or Finance can resolve a QC-complete RMA, transitioning it to Resolved | State machine: QC_COMPLETE → RESOLVED; RmaService.resolve(); audit RMA_RESOLVED |
| LCYC-10 | Returns Agent or Admin can close a Resolved RMA, transitioning it to Closed | State machine: RESOLVED → CLOSED; RmaService.close(); audit RMA_CLOSED |
| LCYC-11 | Returns Agent or Admin can cancel an RMA in Draft, Submitted, Approved, or Info Required status with required cancellation reason | State machine: DRAFT|SUBMITTED|APPROVED|INFO_REQUIRED → CANCELLED; guard: reason non-empty; audit RMA_CANCELLED |
| LINE-01 | Returns Agent can add multiple line items to an RMA, each with part number, quantity, and structured reason code | Schema: RmaLine model with partNumber, orderedQty, reasonCode; nested create on Rma; line add/edit/remove in Draft/InfoRequired |
| LINE-02 | Each RMA line can be assigned a disposition type: credit, replacement, scrap, or RTV | Schema: DispositionType enum; RmaLine.disposition nullable field; lockable after QC |
| LINE-03 | System tracks received quantity and QC-inspected quantity as integers per line | Schema: RmaLine.receivedQty Int default 0; RmaLine.inspectedQty Int default 0; over-receipt allowed; inspected capped at received |
</phase_requirements>

---

## Summary

Phase 2 builds the authoritative state machine and service layer for the complete RMA lifecycle. No REST controllers are added in this phase — the service is the API for Phase 3 to wrap. The core challenge is implementing a well-structured finite state machine as a pure TypeScript transition map (no external library required for this complexity level), with all state changes happening inside Prisma interactive transactions that atomically write both the status update and an audit event. The existing `AuditService.logEvent(tx, ...)` pattern from Phase 1 is the mandatory integration point.

The schema needs two new models added to `prisma/schema.prisma`: `Rma` (with a status enum and the full set of lifecycle fields) and `RmaLine` (with integer `receivedQty` and `inspectedQty` fields, nullable `disposition`). RMA number generation is Claude's discretion. The service layer follows the existing Phase 1 conventions: `@Injectable()` classes with explicit `@Inject(Token)` on all constructor parameters (mandatory due to the esbuild/Vitest `design:paramtypes` limitation discovered in Phase 1).

Testing uses the same dual-runner setup: Jest for unit tests of pure functions (transition guard logic, state validation), Vitest for integration tests against the real database. All new service classes with NestJS DI must use explicit `@Inject()` decorators — this is a locked project constraint carried from Phase 1.

**Primary recommendation:** Implement the state machine as a `TRANSITION_MAP` const object in a dedicated `rma-lifecycle.ts` file; expose it through `RmaService` methods that each validate the transition, perform the DB update, and call `auditService.logEvent(tx, ...)` — all within a single `prisma.$transaction()` call.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @nestjs/common | ^11.0.1 | Injectable, Inject, BadRequestException, ConflictException | Already installed; NestJS DI pattern |
| prisma / @prisma/client | ^7.4.2 | Schema extension (Rma, RmaLine models), interactive transactions | Already installed; project ORM |
| @prisma/adapter-pg | ^7.4.2 | PrismaService adapter (already wired) | Already installed; Prisma 7 requirement |
| zod | ^4.3.6 | Input validation for service method payloads | Already installed; project validation library |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.0.18 | Integration tests (Prisma 7 ESM compatibility) | All integration tests touching DB |
| jest | ^30.0.0 | Unit tests (pure function tests, no DB) | State machine transition map tests, guard logic |
| @nestjs/testing | ^11.0.1 | TestingModule for DI-aware tests | Service integration tests |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom transition map | XState / @depthlabs/nestjs-state-machine | XState adds significant complexity and a large dependency for a well-defined 9-state machine; the custom map is more readable and testable for this use case |
| Custom transition map | @hoeselm/nestjs-state-machine | Community package, limited maintenance signal; custom map has zero additional dependencies |
| Service-layer-only enforcement | DB-level CHECK constraint | DB constraint adds defense-in-depth but requires a migration; service layer is sufficient for v1 |

**Installation:** No new npm installs required. All required packages are already in `rms-api/package.json`. Only schema changes (new Prisma models) are needed.

---

## Architecture Patterns

### Recommended Project Structure

```
rms-api/src/
├── rma/
│   ├── rma.module.ts            # imports PrismaModule, AuditModule
│   ├── rma.service.ts           # all lifecycle methods; owns transitions
│   ├── rma.repository.ts        # DB queries; receives tx from service
│   ├── rma-lifecycle.ts         # TRANSITION_MAP const + isValidTransition()
│   ├── rma.types.ts             # CreateRmaInput, LineInput, etc.
│   ├── rma.service.spec.ts      # Jest unit tests (pure guards + transition map)
│   └── rma.service.integration.spec.ts  # Vitest integration tests
├── audit/                       # (existing Phase 1)
├── auth/                        # (existing Phase 1)
├── prisma/                      # (existing Phase 1)
└── users/                       # (existing Phase 1)
```

### Pattern 1: Transition Map (State Machine)

**What:** A const object keyed by current status that lists the permitted next statuses. A single `assertValidTransition()` function guards every lifecycle method.
**When to use:** All RMA status changes must go through this function before any DB write.

```typescript
// Source: derived from "You don't need a library for state machines"
// (https://dev.to/davidkpiano/you-don-t-need-a-library-for-state-machines-k7h)
// adapted to Prisma enum style

import { RmaStatus } from '../../generated/prisma/client.js';
import { BadRequestException } from '@nestjs/common';

// All permitted transitions. If a (from, to) pair is not listed here,
// it is forbidden — the service throws before touching the DB.
const ALLOWED_TRANSITIONS: Readonly<Record<RmaStatus, readonly RmaStatus[]>> = {
  [RmaStatus.DRAFT]:         [RmaStatus.SUBMITTED, RmaStatus.CANCELLED],
  [RmaStatus.SUBMITTED]:     [RmaStatus.APPROVED, RmaStatus.REJECTED, RmaStatus.INFO_REQUIRED, RmaStatus.CANCELLED],
  [RmaStatus.INFO_REQUIRED]: [RmaStatus.SUBMITTED, RmaStatus.CANCELLED],
  [RmaStatus.APPROVED]:      [RmaStatus.RECEIVED, RmaStatus.CANCELLED],
  [RmaStatus.RECEIVED]:      [RmaStatus.QC_COMPLETE],
  [RmaStatus.QC_COMPLETE]:   [RmaStatus.RESOLVED],
  [RmaStatus.RESOLVED]:      [RmaStatus.CLOSED],
  [RmaStatus.REJECTED]:      [],   // terminal
  [RmaStatus.CANCELLED]:     [],   // terminal
  [RmaStatus.CLOSED]:        [],   // terminal
} as const;

export function assertValidTransition(from: RmaStatus, to: RmaStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new BadRequestException({
      error: 'INVALID_TRANSITION',
      message: `Cannot transition RMA from ${from} to ${to}`,
      allowedTransitions: ALLOWED_TRANSITIONS[from],
    });
  }
}
```

### Pattern 2: Atomic Lifecycle Method (Service)

**What:** Every service method that changes RMA status follows the same structure: (1) fetch current RMA, (2) validate transition, (3) validate business guards, (4) open transaction, (5) update RMA, (6) log audit — in that exact order.
**When to use:** All 11 lifecycle methods (LCYC-01 through LCYC-11).

```typescript
// Source: AuditService.logEvent() pattern from Phase 1 (src/audit/audit.service.ts)
// + Prisma interactive transaction docs (https://www.prisma.io/docs/orm/prisma-client/queries/transactions)

async approve(rmaId: string, actor: RmsUserContext): Promise<Rma> {
  // Step 1: fetch — outside transaction (read-only, fast)
  const rma = await this.rmaRepository.findById(rmaId);
  if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

  // Step 2: validate transition (throws BadRequestException if invalid)
  assertValidTransition(rma.status, RmaStatus.APPROVED);

  // Step 3: business guards (role check is done at controller layer in Phase 3;
  //          branch scope check belongs here for defense-in-depth)

  // Step 4+5+6: atomic write
  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.rma.update({
      where: { id: rmaId },
      data: { status: RmaStatus.APPROVED, updatedAt: new Date() },
    });
    await this.auditService.logEvent(tx, {
      rmaId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AuditAction.RMA_APPROVED,
      fromStatus: rma.status,
      toStatus: RmaStatus.APPROVED,
    });
    return updated;
  });
}
```

### Pattern 3: RMA Creation with Nested Line Items

**What:** Create the RMA and its initial line items in a single Prisma nested write inside a transaction. The nested `create` array handles the one-to-many in one round-trip.
**When to use:** LCYC-01 / LINE-01 — `RmaService.createDraft()`.

```typescript
// Source: Prisma CRUD docs — nested writes
// https://www.prisma.io/docs/orm/prisma-client/queries/relation-queries

return this.prisma.$transaction(async (tx) => {
  const rma = await tx.rma.create({
    data: {
      rmaNumber: generateRmaNumber(),   // Claude's discretion: format
      status: RmaStatus.DRAFT,
      branchId: input.branchId,
      customerId: input.customerId,
      submittedById: actor.id,
      lines: {
        create: input.lines.map((line) => ({
          partNumber: line.partNumber,
          orderedQty: line.orderedQty,
          reasonCode: line.reasonCode,
          disposition: line.disposition ?? null,
          receivedQty: 0,
          inspectedQty: 0,
        })),
      },
    },
    include: { lines: true },
  });

  await this.auditService.logEvent(tx, {
    rmaId: rma.id,
    actorId: actor.id,
    actorRole: actor.role,
    action: AuditAction.RMA_CREATED,
    toStatus: RmaStatus.DRAFT,
    newValue: { rmaNumber: rma.rmaNumber, lineCount: rma.lines.length },
  });

  return rma;
});
```

### Pattern 4: Partial Receipt (First-Receipt Transition)

**What:** Recording receipt on an `APPROVED` RMA updates the line's `receivedQty` and, if this is the first receipt on the RMA, atomically transitions the RMA status to `RECEIVED`.
**When to use:** LCYC-07, LINE-03.

```typescript
// Key logic: detect "first receipt" by checking if ALL lines currently have receivedQty === 0
// before the update. If so, this update triggers the RMA status transition.

return this.prisma.$transaction(async (tx) => {
  // Guard: inspected qty cannot exceed received qty (LINE-03)
  if (input.receivedQty < existingLine.inspectedQty) {
    throw new BadRequestException('Cannot reduce receivedQty below inspectedQty');
  }

  const isFirstReceipt = rma.lines.every((l) => l.receivedQty === 0);

  await tx.rmaLine.update({
    where: { id: lineId },
    data: { receivedQty: input.receivedQty },
  });

  if (isFirstReceipt) {
    assertValidTransition(rma.status, RmaStatus.RECEIVED);
    await tx.rma.update({
      where: { id: rma.id },
      data: { status: RmaStatus.RECEIVED },
    });
  }

  await this.auditService.logEvent(tx, {
    rmaId: rma.id,
    rmaLineId: lineId,
    actorId: actor.id,
    actorRole: actor.role,
    action: AuditAction.RMA_RECEIVED,
    fromStatus: isFirstReceipt ? rma.status : undefined,
    toStatus: isFirstReceipt ? RmaStatus.RECEIVED : undefined,
    newValue: { receivedQty: input.receivedQty },
  });
});
```

### Pattern 5: NestJS DI — Explicit @Inject() Required

**What:** Every constructor parameter in any NestJS-DI-managed class MUST use `@Inject(Token)`. esbuild (used by Vitest) does not emit `design:paramtypes` metadata, so NestJS cannot infer injection tokens automatically.
**When to use:** ALL new services, repositories, modules added in Phase 2.

```typescript
// Source: Phase 1 post-mortems in STATE.md; confirmed by esbuild/NestJS docs
// Pattern established across MerpStubAdapter, JwtStrategy, RmsAuthGuard, etc.

@Injectable()
export class RmaService {
  constructor(
    @Inject(PrismaService)  private readonly prisma: PrismaService,
    @Inject(AuditService)   private readonly auditService: AuditService,
    @Inject(RmaRepository)  private readonly rmaRepository: RmaRepository,
  ) {}
}
```

### Anti-Patterns to Avoid

- **Missing `@Inject()` on constructor parameters:** Causes "Cannot read properties of undefined" in Vitest integration tests. All new classes must use explicit `@Inject(Token)` on every parameter. (Phase 1 lesson — STATE.md)
- **Calling `logEvent()` outside a transaction:** The AuditService signature requires a `Prisma.TransactionClient` — this is a compile-time enforcement. Never call `auditService.logEvent()` with `this.prisma` directly.
- **Nested Prisma transactions:** Prisma does not support nested `$transaction()` calls. Design service methods so the transaction is opened once at the top level and passed down.
- **Mutating terminal states:** Do not include REJECTED, CANCELLED, or CLOSED as keys with non-empty transition arrays in `ALLOWED_TRANSITIONS`. They are terminal — any write attempt returns an error.
- **Locking disposition before QC:** Disposition must remain updatable until the service records QC inspection on that line. The lock-after-QC guard belongs in the service, not a DB constraint (for v1).
- **Line editing after submission:** Lines are locked (no add/edit/remove) once the RMA leaves DRAFT or INFO_REQUIRED. Validate the RMA status before accepting line mutations.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic audit writes | Custom try/catch + separate write | `prisma.$transaction(async tx => { ...; auditService.logEvent(tx, ...) })` | Phase 1 already established this pattern; breaking it loses the atomicity guarantee (FOUND-04) |
| Line items creation | Separate `prisma.rmaLine.createMany()` after RMA create | Prisma nested `create: [...]` inside `rma.create()` | Nested write is one round-trip and transactional by default |
| State validation | switch/case in each service method | `assertValidTransition(from, to)` called at the top of every method | Centralizes the state machine; a single point to add transitions; exhaustively testable |
| Input parsing | Manual field checks in service | Zod schema validated before entering service methods | Zod is already in the project; consistent with Phase 1 config validation pattern |
| RMA number uniqueness | Custom counter table | PostgreSQL unique constraint on `rmaNumber` + retry on conflict | DB-native uniqueness is more reliable than application-level counters under concurrency |

**Key insight:** The entire state machine is a static data structure (`ALLOWED_TRANSITIONS`) tested separately from the service. This means you can unit test every possible transition combination in Jest without any DB or DI setup.

---

## Common Pitfalls

### Pitfall 1: Missing @Inject() Causes Silent DI Failure in Vitest
**What goes wrong:** `RmaService` works in `nest start` but crashes in integration tests with "Cannot read properties of undefined (reading 'rma')" because `this.prisma` is `undefined`.
**Why it happens:** esbuild (Vitest's bundler) does not emit `design:paramtypes` metadata. NestJS requires this to auto-resolve injection tokens. Without it, injected values are undefined at runtime in test contexts.
**How to avoid:** Use `@Inject(PrismaService)`, `@Inject(AuditService)`, `@Inject(RmaRepository)` on every constructor parameter. No exceptions. (Source: STATE.md — "post-01-04" decisions.)
**Warning signs:** Test error contains "Cannot read properties of undefined" or "is not a function" on a property that should be injected.

### Pitfall 2: Multi-Module DI — Forgetting to Import Modules
**What goes wrong:** `RmaModule` uses `AuditService` but gets "Nest can't resolve dependencies" at test startup.
**Why it happens:** `@Global()` on `PrismaModule` propagates the PrismaService, but `AuditModule` is not global. `RmaModule` must explicitly `import: [AuditModule]`.
**How to avoid:** Every module that uses a service from another module must import that module, even if it's a single-hop dependency. (Source: STATE.md — "AuthModule must explicitly import ConfigModule".)
**Warning signs:** "Nest can't resolve dependencies of RmaService" error at module init.

### Pitfall 3: Race Condition on First-Receipt Transition
**What goes wrong:** Two concurrent warehouse writes on different lines both detect `isFirstReceipt = true` and both try to transition the RMA to RECEIVED, causing a conflict or double audit entry.
**Why it happens:** The "check then write" pattern has a TOCTOU gap when outside a transaction or without a row lock.
**How to avoid:** Do the "is first receipt" check and the status update inside the same `$transaction()` call. Prisma interactive transactions serialize on a single connection per call.
**Warning signs:** Duplicate audit events with `action = RMA_RECEIVED` on the same RMA within milliseconds.

### Pitfall 4: Over-Receipt Silently Rejected Instead of Allowed
**What goes wrong:** Service throws a validation error when `receivedQty > orderedQty`, blocking legitimate over-shipment tracking.
**Why it happens:** Developer assumes "received > ordered = error" (the intuitive interpretation). But the user decision locks this: over-receipt is explicitly allowed.
**How to avoid:** The only quantity guard on receipt is `receivedQty >= 0`. The capped guard (`inspectedQty <= receivedQty`) applies only to QC inspection writes.
**Warning signs:** Warehouse staff cannot log a received quantity higher than the ordered quantity.

### Pitfall 5: Disposition Lock Applied Too Early or Too Late
**What goes wrong:** Disposition is locked at submission (too early — Finance can't update) or never locked (too late — allows post-QC changes).
**Why it happens:** The lock rule (after QC inspection per line) is nuanced. A simple status check on the RMA (`status === QC_COMPLETE`) is wrong — it would lock all lines when the first line is inspected.
**How to avoid:** Track QC inspection at the line level (`inspectedQty > 0` or a dedicated `qcInspectedAt` timestamp per line). Disposition lock guard should check the specific line's QC state, not the overall RMA status.
**Warning signs:** All lines become uneditable after any QC inspection, or lines remain editable after individual QC.

### Pitfall 6: Prisma Nested Transactions Attempted
**What goes wrong:** A repository method starts its own `$transaction()` and is called from a service that also calls `$transaction()`.
**Why it happens:** Developer tries to reuse a repository method (which has its own transaction) from inside a service transaction.
**How to avoid:** Repository methods accept an optional `tx: Prisma.TransactionClient` parameter. When called from a service transaction, pass `tx`. Never start a nested transaction.
**Warning signs:** Runtime error "Cannot call $transaction inside another transaction" or unexpected behavior where inner transaction commits before outer one fails.

---

## Code Examples

Verified patterns from official sources and existing codebase:

### RMA Schema Extension (Prisma)

```prisma
// Add to rms-api/prisma/schema.prisma
// Source: Prisma schema docs + existing Phase 1 schema patterns

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
}

enum DispositionType {
  CREDIT
  REPLACEMENT
  SCRAP
  RTV
}

model Rma {
  id            String    @id @default(uuid())
  rmaNumber     String    @unique           // generated; format is Claude's discretion
  status        RmaStatus @default(DRAFT)
  branchId      String
  customerId    String?                     // nullable: internal RMAs may not have customer
  submittedById String                      // FK -> User (the Returns Agent or Customer who owns it)
  cancellationReason String?
  rejectionReason    String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  submittedBy   User      @relation("SubmittedRmas", fields: [submittedById], references: [id])
  branch        Branch    @relation(fields: [branchId], references: [id])
  lines         RmaLine[]
  auditEvents   AuditEvent[]  @relation("RmaAuditEvents")  // back-reference for queries

  @@index([branchId])
  @@index([status])
  @@index([customerId])
}

model RmaLine {
  id             String          @id @default(uuid())
  rmaId          String
  partNumber     String
  orderedQty     Int
  reasonCode     String                  // structured: e.g. "DEFECTIVE", "WRONG_ITEM"
  disposition    DispositionType?        // nullable until set; locked after QC
  receivedQty    Int             @default(0)
  inspectedQty   Int             @default(0)
  qcInspectedAt  DateTime?               // set when QC records inspection; disposition lock trigger
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  rma            Rma             @relation(fields: [rmaId], references: [id], onDelete: Cascade)

  @@index([rmaId])
}
```

### RmaModule Definition

```typescript
// Source: Phase 1 module pattern (audit.module.ts, auth.module.ts)
// All services require @Inject() — esbuild constraint

import { Module } from '@nestjs/common';
import { RmaService } from './rma.service.js';
import { RmaRepository } from './rma.repository.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],       // MUST import — not global
  providers: [RmaService, RmaRepository],
  exports: [RmaService],
})
export class RmaModule {}
```

### Jest Unit Test — Transition Map

```typescript
// Source: Jest unit test pattern (branch-scope.spec.ts from Phase 1)
// Pure function test — no DB, no DI

import { assertValidTransition } from './rma-lifecycle.js';
import { RmaStatus } from '../../generated/prisma/enums.js';
import { BadRequestException } from '@nestjs/common';

describe('assertValidTransition', () => {
  it('allows DRAFT → SUBMITTED', () => {
    expect(() => assertValidTransition(RmaStatus.DRAFT, RmaStatus.SUBMITTED)).not.toThrow();
  });

  it('rejects DRAFT → APPROVED (not a direct transition)', () => {
    expect(() => assertValidTransition(RmaStatus.DRAFT, RmaStatus.APPROVED))
      .toThrow(BadRequestException);
  });

  it('rejects writes to terminal CANCELLED status', () => {
    expect(() => assertValidTransition(RmaStatus.CANCELLED, RmaStatus.DRAFT))
      .toThrow(BadRequestException);
  });
});
```

### Integration Test Pattern (Vitest)

```typescript
// Source: audit.integration.spec.ts pattern (Phase 1)
// Vitest required for Prisma 7 ESM compatibility

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { RmaModule } from './rma.module.js';
import { RmaService } from './rma.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('RmaService — LCYC-01: Create Draft RMA', () => {
  let rmaService: RmaService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        RmaModule,
      ],
    }).compile();

    rmaService = moduleRef.get(RmaService);
    prisma = moduleRef.get(PrismaService);
  });

  it('LCYC-01: creates RMA in DRAFT with audit event in same transaction', async () => {
    // seed actor user, test the service method, assert both DB rows exist
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| XState for all state machines | Custom transition map for simple, well-defined machines | Ongoing community discussion | XState v5 rewrote the API in 2024; for a 9-state machine with no parallel states, a plain object map is simpler and more readable |
| Prisma `$queryRaw` for transactions | `prisma.$transaction(async tx => {...})` interactive API | Prisma 2.29+ | Interactive transactions are the standard; batch API is for simple sequential operations |
| Jest for all NestJS tests | Jest (unit) + Vitest (integration) dual-runner | Emerged with Prisma 7 ESM-only client | Prisma 7 generates ESM-only client; Vitest handles ESM natively; Jest requires VM module flags that break NestJS CJS decorators |

**Deprecated/outdated:**
- `prisma.$transaction([op1, op2])` batch API: Still valid for independent sequential operations, but cannot pass data between steps or do conditional logic. Use interactive API (`prisma.$transaction(async tx => {...})`) for lifecycle methods.
- Implicit `@Inject()` without argument (esbuild context): Removed as viable pattern after Phase 1. All new code uses explicit `@Inject(Token)`.

---

## Open Questions

1. **RMA Number Format**
   - What we know: Must be unique; Claude's discretion on format
   - What's unclear: Should it be human-readable (e.g., `RMA-2026-00001`) or UUID-based?
   - Recommendation: Use a sequential human-readable format: `RMA-YYYYMM-NNNNNN` where NNNNNN is a zero-padded sequence based on `COUNT(*)` + 1. Store as unique varchar. Add retry on unique constraint violation for concurrency safety.

2. **Line-Level Disposition Lock vs. RMA-Level QC State**
   - What we know: Disposition locked "after QC inspection on a line"; `qcInspectedAt` per line is the trigger
   - What's unclear: Does the service need a separate `lockDisposition()` call, or is `qcInspectedAt IS NOT NULL` the implicit lock?
   - Recommendation: Use `qcInspectedAt IS NOT NULL` as the implicit lock. The service checks this before accepting any disposition update and rejects with a clear error. No separate lock step needed.

3. **Info Required Resubmission Mechanism**
   - What we know: Claude's discretion — dedicated endpoint vs. implicit on any update
   - What's unclear: Whether the API caller explicitly calls "resubmit" or whether updating any line while in INFO_REQUIRED implicitly triggers the transition
   - Recommendation: Implement a dedicated `RmaService.resubmit(rmaId, actor)` method. Explicit is clearer for audit trails and Phase 3 API design. The planner should model this as a separate service method.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30 (unit) + Vitest 4 (integration) |
| Config file | `rms-api/package.json` (jest config block) + `rms-api/vitest.integration.config.ts` |
| Quick run command (unit) | `cd rms-api && npm test -- --testPathPattern=rma` |
| Full suite command | `cd rms-api && npm run test:all` |
| Integration run command | `cd rms-api && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LCYC-01 | Create Draft RMA with lines, audit event written | integration | `npm run test:e2e` (rma.service.integration) | No — Wave 0 |
| LCYC-02 | DRAFT → SUBMITTED transition; guard: lines exist | unit + integration | `npm test -- rma` (transition map) + `npm run test:e2e` | No — Wave 0 |
| LCYC-03 | SUBMITTED → APPROVED transition | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| LCYC-04 | SUBMITTED → REJECTED; guard: reason required | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| LCYC-05 | SUBMITTED → INFO_REQUIRED transition | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| LCYC-06 | INFO_REQUIRED → SUBMITTED (resubmit) | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| LCYC-07 | APPROVED → RECEIVED on first receipt; receivedQty update | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| LCYC-08 | RECEIVED → QC_COMPLETE; inspected ≤ received guard | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| LCYC-09 | QC_COMPLETE → RESOLVED | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| LCYC-10 | RESOLVED → CLOSED | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| LCYC-11 | DRAFT|SUBMITTED|APPROVED|INFO_REQUIRED → CANCELLED; reason required | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| LINE-01 | Add multiple lines; line lock after SUBMITTED | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| LINE-02 | Disposition set/update; locked after QC per line | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |
| LINE-03 | receivedQty / inspectedQty integer tracking; over-receipt allowed; inspected ≤ received | unit + integration | `npm test -- rma` + `npm run test:e2e` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `cd rms-api && npm test -- --testPathPattern=rma` (unit tests only, ~5s)
- **Per wave merge:** `cd rms-api && npm run test:all` (unit + integration)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

All test files for Phase 2 need to be created. The test infrastructure itself (Jest config, Vitest config, `vitest.integration.config.ts`) is already in place from Phase 1.

- [ ] `rms-api/src/rma/rma.service.spec.ts` — Jest unit tests: transition map, guards, invalid transitions for all LCYC requirements
- [ ] `rms-api/src/rma/rma.service.integration.spec.ts` — Vitest integration tests: all LCYC and LINE requirements against real DB

No framework installation needed — Jest and Vitest are already installed.

---

## Sources

### Primary (HIGH confidence)

- Prisma interactive transaction docs — https://www.prisma.io/docs/orm/prisma-client/queries/transactions — transaction API, `$transaction(async tx => {})` pattern, timeout defaults
- Prisma CRUD / relation queries docs — https://www.prisma.io/docs/orm/prisma-client/queries/relation-queries — nested write `create: [...]` array pattern
- Project codebase (Phase 1): `rms-api/src/audit/audit.service.ts` — `logEvent(tx, input)` signature; mandatory tx parameter
- Project codebase (Phase 1): `rms-api/src/audit/audit.types.ts` — `AuditAction` constants, `AuditEventInput` type
- Project codebase (Phase 1): `rms-api/src/prisma/prisma.service.ts` — PrismaService extending PrismaClient with PrismaPg adapter
- Project codebase (Phase 1): `rms-api/vitest.integration.config.ts` — Vitest ESM integration test runner config
- Project state: `.planning/STATE.md` — esbuild `design:paramtypes` constraint, `@Inject(Token)` requirement, multi-module import requirement

### Secondary (MEDIUM confidence)

- "You don't need a library for state machines" (David Khourshid, DEV) — https://dev.to/davidkpiano/you-don-t-need-a-library-for-state-machines-k7h — confirmed by XState docs that simple state machines can be plain objects
- Wanago — "API with NestJS #104. Writing transactions with Prisma" — https://wanago.io/2023/04/17/api-nestjs-prisma-transactions/ — cross-module transaction passing via method parameters

### Tertiary (LOW confidence)

- `@nestjs-cls/transactional` Prisma adapter — https://papooch.github.io/nestjs-cls/plugins/available-plugins/transactional/prisma-adapter — alternative to explicit tx passing; NOT recommended here because it would change the existing Phase 1 AuditService signature and add a dependency

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed; no new dependencies needed
- Schema extension: HIGH — Prisma schema patterns verified against official docs; existing Phase 1 schema as template
- State machine pattern: HIGH — plain TypeScript transition map is well-established; verified against authoritative source (XState creator's blog post)
- Transaction + audit pattern: HIGH — directly derived from Phase 1 implementation in codebase
- Pitfalls: HIGH — all Phase 1 pitfalls (esbuild, multi-module import) confirmed by STATE.md; new pitfalls derived from design decisions in CONTEXT.md

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (30 days — Prisma and NestJS patterns are stable; esbuild/Vitest constraint is project-permanent until test infrastructure changes)
