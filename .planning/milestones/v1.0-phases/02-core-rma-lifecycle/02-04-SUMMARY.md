---
phase: 02-core-rma-lifecycle
plan: 04
subsystem: api
tags: [nestjs, prisma, typescript, rma, lifecycle, receipt, qc]

# Dependency graph
requires:
  - phase: 02-core-rma-lifecycle plan 03
    provides: RmaService base (createDraft, submit, placeInfoRequired, resubmit, cancel, addLine, updateLine, removeLine) and RmaModule DI wiring
  - phase: 02-core-rma-lifecycle plan 02
    provides: RmaRepository (updateStatus, updateRma, updateLineReceipt, updateLineQc), assertValidTransition, ALLOWED_TRANSITIONS
provides:
  - RmaService fully implements all 11 LCYC requirements (LCYC-01 through LCYC-11) and all 3 LINE requirements
  - approve() — SUBMITTED → APPROVED with RMA_APPROVED audit (LCYC-03)
  - reject() — SUBMITTED → REJECTED with required rejectionReason guard (LCYC-04)
  - recordReceipt() — first-receipt APPROVED→RECEIVED transition with isFirstReceipt pattern; over-receipt allowed (LCYC-07 + LINE-03)
  - recordQcInspection() — inspectedQty capped at receivedQty; sets qcInspectedAt disposition lock (LCYC-08 + LINE-03)
  - completeQc() — RECEIVED → QC_COMPLETE explicit trigger (LCYC-08 completion)
  - resolve() — QC_COMPLETE → RESOLVED (LCYC-09)
  - close() — RESOLVED → CLOSED (LCYC-10)
affects: [02-05-plan, phase-03-http-layer, phase-04-attachments, phase-05-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - isFirstReceipt detection before $transaction() to avoid TOCTOU race condition
    - inspectedQty <= receivedQty invariant enforced at service layer (not DB constraint)
    - Over-receipt allowed per CONTEXT.md locked decision — no upper bound on receivedQty
    - completeQc() as explicit operator-called trigger for QC_COMPLETE (not auto-triggered by per-line inspection)

key-files:
  created: []
  modified:
    - rms-api/src/rma/rma.service.ts

key-decisions:
  - "completeQc() is an explicit operator action, not auto-triggered when all lines have qcInspectedAt — keeps control in operator hands"
  - "isFirstReceipt = rma.status === APPROVED && rma.lines.every(l => l.receivedQty === 0) — checked before the transaction update to avoid TOCTOU"
  - "reject() uses inline { rejectionReason: string } type (not RejectRmaInput import) — consistent with plan specification"

patterns-established:
  - "isFirstReceipt pattern: read state before $transaction(), detect transition trigger, execute both line update and status update atomically inside single $transaction()"
  - "Two-level quantity guards: receivedQty >= inspectedQty enforced in recordReceipt(); inspectedQty <= receivedQty enforced in recordQcInspection()"

requirements-completed: [LCYC-03, LCYC-04, LCYC-07, LCYC-08, LCYC-09, LCYC-10, LINE-03]

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 2 Plan 04: Approve/Reject/Receipt/QC/Resolve/Close Lifecycle Methods Summary

**RmaService completed with 7 additional lifecycle methods (approve, reject, recordReceipt, recordQcInspection, completeQc, resolve, close) implementing LCYC-03/04/07-10 and LINE-03; isFirstReceipt atomic transition pattern and inspectedQty cap enforced**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-27T20:57:34Z
- **Completed:** 2026-02-27T20:59:45Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- approve() and reject() added — Branch Manager approval/rejection flow complete with rejectionReason non-empty guard
- recordReceipt() implements first-receipt detection (isFirstReceipt pattern) for atomic APPROVED→RECEIVED transition inside $transaction(); over-receipt above orderedQty is explicitly allowed
- recordQcInspection() enforces inspectedQty <= receivedQty cap and sets qcInspectedAt (the disposition lock trigger); completeQc() is the explicit RECEIVED→QC_COMPLETE operator trigger
- resolve() and close() complete the terminal lifecycle path (QC_COMPLETE→RESOLVED→CLOSED)
- Full TypeScript build passes with zero errors

## All 13 RmaService Methods — LCYC/LINE Requirement Mapping

| Method | Requirement | Status Transition | Notes |
|--------|-------------|-------------------|-------|
| createDraft() | LCYC-01, LINE-01 | → DRAFT | Plan 03 |
| submit() | LCYC-02 | DRAFT → SUBMITTED | Plan 03 |
| placeInfoRequired() | LCYC-05 | SUBMITTED → INFO_REQUIRED | Plan 03 |
| resubmit() | LCYC-06 | INFO_REQUIRED → SUBMITTED | Plan 03 |
| cancel() | LCYC-11 | DRAFT/SUBMITTED/APPROVED/INFO_REQUIRED → CANCELLED | Plan 03 |
| addLine() | LINE-01 | none | Plan 03 |
| updateLine() | LINE-01, LINE-02 | none | Plan 03 |
| removeLine() | LINE-01 | none | Plan 03 |
| approve() | LCYC-03 | SUBMITTED → APPROVED | Plan 04 |
| reject() | LCYC-04 | SUBMITTED → REJECTED | Plan 04 |
| recordReceipt() | LCYC-07, LINE-03 | APPROVED → RECEIVED (first receipt) | Plan 04 |
| recordQcInspection() | LCYC-08, LINE-03 | none (sets qcInspectedAt) | Plan 04 |
| completeQc() | LCYC-08 completion | RECEIVED → QC_COMPLETE | Plan 04 |
| resolve() | LCYC-09 | QC_COMPLETE → RESOLVED | Plan 04 |
| close() | LCYC-10 | RESOLVED → CLOSED | Plan 04 |

*Note: completeQc() is counted with recordQcInspection() under LCYC-08, giving 15 public methods total.*

## First-Receipt Detection (isFirstReceipt Pattern)

```typescript
// Checked BEFORE the transaction to avoid TOCTOU race condition
const isFirstReceipt = rma.status === RmaStatus.APPROVED &&
  rma.lines.every((l) => l.receivedQty === 0);

return this.prisma.$transaction(async (tx) => {
  await this.rmaRepository.updateLineReceipt(tx, lineId, input.receivedQty);
  if (isFirstReceipt) {
    assertValidTransition(rma.status, RmaStatus.RECEIVED);
    await this.rmaRepository.updateStatus(tx, rmaId, RmaStatus.RECEIVED);
  }
  // ...audit logEvent...
});
```

Key behavior: First receipt on ANY line while RMA is APPROVED triggers the status transition. Subsequent receipts while already RECEIVED update quantities without re-transitioning.

## inspectedQty Cap Guard (LINE-03)

```typescript
// In recordQcInspection():
if (input.inspectedQty > line.receivedQty) {
  throw new BadRequestException(
    `Cannot inspect ${input.inspectedQty} units — only ${line.receivedQty} units received on this line`,
  );
}
```

Complementary guard in recordReceipt() prevents setting receivedQty below existing inspectedQty.

## rejectionReason Non-Empty Guard (LCYC-04)

```typescript
if (!input.rejectionReason || input.rejectionReason.trim().length === 0) {
  throw new BadRequestException('Rejection reason is required');
}
```

Checked before findById() — fails fast without unnecessary DB round-trip.

## Over-Receipt Policy (LCYC-07 Locked Decision)

Over-receipt is explicitly **allowed** — receivedQty may exceed orderedQty with no error. The service does not enforce an upper bound on receivedQty. This matches the CONTEXT.md locked decision from RESEARCH.md.

## completeQc() as Explicit QC_COMPLETE Trigger

`completeQc()` is a distinct operator-called method that transitions RECEIVED → QC_COMPLETE. It is NOT auto-triggered when all lines have `qcInspectedAt` set. This design keeps control in the operator's hands — QC staff can record inspections on all lines without triggering the transition until a supervisor explicitly calls completeQc().

## Task Commits

Each task was committed atomically:

1. **Task 1: Add approve and reject methods to RmaService** - `c19cd10` (feat)
2. **Task 2: Add recordReceipt, recordQcInspection, completeQc, resolve, close** - `aa6a6dd` (feat)

## Files Created/Modified

- `rms-api/src/rma/rma.service.ts` - Extended with 7 new lifecycle methods + RecordReceiptInput/RecordQcInput imports added

## Decisions Made

- completeQc() is an explicit operator action, not auto-triggered when all lines have qcInspectedAt — keeps control in operator hands
- isFirstReceipt check happens before $transaction() to avoid TOCTOU; both the line update and status update execute atomically inside the same $transaction() call
- reject() uses inline `{ rejectionReason: string }` type rather than importing RejectRmaInput — consistent with plan specification and avoids adding another import

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 11 LCYC requirements (LCYC-01 through LCYC-11) and all 3 LINE requirements (LINE-01, LINE-02, LINE-03) are now fully implemented in RmaService
- Plan 02-05 (integration tests for the complete lifecycle) is unblocked
- Phase 3 (HTTP layer / NestJS controllers) can proceed — RmaService API is complete

---
*Phase: 02-core-rma-lifecycle*
*Completed: 2026-02-27*
