---
phase: 02-core-rma-lifecycle
plan: "03"
subsystem: rma-service
tags: [nestjs, service, lifecycle, line-mutations, audit, transactions]
dependency_graph:
  requires:
    - 02-02-PLAN  # rma-lifecycle.ts (assertValidTransition) and rma.repository.ts
  provides:
    - RmaService with createDraft, submit, placeInfoRequired, resubmit, cancel
    - RmaService with addLine, updateLine, removeLine
    - RmaModule (NestJS DI wiring)
  affects:
    - app.module.ts (RmaModule added to imports)
    - 02-04-PLAN  # Will build on RmaService for approve/reject/receive/qc/resolve
tech_stack:
  added: []
  patterns:
    - fetch-outside-transaction + assertValidTransition + $transaction pattern
    - @Inject(Token) on all constructor params (Vitest DI safety)
    - auditService.logEvent(tx) inside every $transaction
    - LINE_EDITABLE_STATUSES guard for line mutation lock
key_files:
  created:
    - rms-api/src/rma/rma.module.ts
    - rms-api/src/rma/rma.service.ts
  modified:
    - rms-api/src/app.module.ts
decisions:
  - "@Inject(Token) on all three RmaService constructor params — esbuild DI safety enforced"
  - "LINE_EDITABLE_STATUSES = [DRAFT, INFO_REQUIRED] — lines locked from SUBMITTED onward"
  - "resubmit() logs AuditAction.RMA_SUBMITTED with metadata.cycle='resubmit' (not a separate action)"
  - "removeLine uses LINE_UPDATED audit action (not LINE_REMOVED) — consistent with existing audit action set"
metrics:
  duration: "2 min"
  completed_date: "2026-02-27"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
---

# Phase 2 Plan 03: RmaModule and RmaService (Lifecycle + Line Mutations) Summary

**One-liner:** NestJS RmaModule DI wiring + RmaService implementing 5 lifecycle transitions (LCYC-01/02/05/06/11) and 3 line mutation methods (LINE-01/02) with atomic $transaction + audit pattern.

## What Was Built

### rma.module.ts

NestJS module providing the DI container for the RMA subsystem:

```typescript
@Module({
  imports: [AuditModule],            // NOT global — explicit import required
  providers: [RmaService, RmaRepository],
  exports: [RmaService],             // Phase 3 controllers will inject RmaService
})
export class RmaModule {}
```

AuditModule is explicitly imported because it is not decorated with `@Global()`. PrismaModule is `@Global()` so PrismaService is available without importing PrismaModule here.

### rma.service.ts — Service Methods Implemented

| Method | Requirement | Transition | Audit Action |
|--------|-------------|------------|--------------|
| `createDraft()` | LCYC-01 + LINE-01 | — → DRAFT | RMA_CREATED |
| `submit()` | LCYC-02 | DRAFT → SUBMITTED | RMA_SUBMITTED |
| `placeInfoRequired()` | LCYC-05 | SUBMITTED → INFO_REQUIRED | RMA_INFO_REQUIRED |
| `resubmit()` | LCYC-06 | INFO_REQUIRED → SUBMITTED | RMA_SUBMITTED (metadata.cycle='resubmit') |
| `cancel()` | LCYC-11 | DRAFT/SUBMITTED/APPROVED/INFO_REQUIRED → CANCELLED | RMA_CANCELLED |
| `addLine()` | LINE-01 | — (no status change) | LINE_ADDED |
| `updateLine()` | LINE-01/LINE-02 | — (no status change) | LINE_UPDATED or DISPOSITION_SET |
| `removeLine()` | LINE-01 | — (no status change) | LINE_UPDATED (removed: true) |

### Key Implementation Details

**Constructor injection pattern (@Inject enforced):**

```typescript
constructor(
  @Inject(PrismaService)  private readonly prisma: PrismaService,
  @Inject(AuditService)   private readonly auditService: AuditService,
  @Inject(RmaRepository)  private readonly rmaRepository: RmaRepository,
) {}
```

All three constructor parameters use `@Inject(Token)` as required by the project-wide Vitest DI constraint (esbuild does not emit `design:paramtypes`).

**Atomic pattern (used in every method):**

```typescript
// 1. Fetch outside transaction
const rma = await this.rmaRepository.findById(rmaId);
// 2. Validate transition
assertValidTransition(rma.status, RmaStatus.SUBMITTED);
// 3. Business guards
if (rma.lines.length === 0) throw new BadRequestException(...)
// 4. Transaction: DB write + audit log in same atomic unit
return this.prisma.$transaction(async (tx) => {
  await this.rmaRepository.updateStatus(tx, rmaId, RmaStatus.SUBMITTED);
  await this.auditService.logEvent(tx, { ... });  // logEvent(tx inside $transaction)
  return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
});
```

**Line lock guard (LINE-01):**

```typescript
const LINE_EDITABLE_STATUSES: RmaStatus[] = [RmaStatus.DRAFT, RmaStatus.INFO_REQUIRED];

// Appears in addLine, updateLine, and removeLine:
if (!LINE_EDITABLE_STATUSES.includes(rma.status)) {
  throw new BadRequestException(`Cannot add/edit/remove lines ... lines are locked after submission`);
}
```

**Disposition lock guard (LINE-02):**

```typescript
// In updateLine only — per-line check:
if (data.disposition !== undefined && line.qcInspectedAt !== null) {
  throw new BadRequestException(`Cannot update disposition ... QC inspection has been recorded`);
}
```

**Cancellation reason guard (LCYC-11):**

```typescript
if (!input.cancellationReason || input.cancellationReason.trim().length === 0) {
  throw new BadRequestException('Cancellation reason is required');
}
```

### AppModule Update

`RmaModule` added to AppModule imports array (after MerpModule):

```typescript
import { RmaModule } from './rma/rma.module.js';
// ...
imports: [..., MerpModule, RmaModule]
```

## Verification Results

| Check | Result |
|-------|--------|
| AuditModule in rma.module.ts imports | PASS |
| [RmaService, RmaRepository] in providers | PASS |
| RmaModule imported in app.module.ts | PASS |
| @Inject() decorators count | 3 (PASS) |
| logEvent(tx) call count | 8 (PASS) |
| cancellationReason trim guard | PASS |
| LINE_EDITABLE_STATUSES in addLine, updateLine, removeLine | PASS |
| Full TypeScript build (npm run build) | 0 errors (PASS) |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] rms-api/src/rma/rma.module.ts — created
- [x] rms-api/src/rma/rma.service.ts — created
- [x] rms-api/src/app.module.ts — modified
- [x] Commit e6a1430: feat(02-03): create RmaModule and wire into AppModule
- [x] Commit 69c9944: feat(02-03): implement RmaService lifecycle and line mutation methods
- [x] TypeScript build passes with zero errors

## Self-Check: PASSED
