---
phase: 03-workflow-and-line-operations
plan: 02
subsystem: api
tags: [nestjs, prisma, rma, service-layer, repository-pattern, workflow, line-operations]

# Dependency graph
requires:
  - phase: 03-01
    provides: "CONTESTED state in schema, Phase 3 input contracts in rma.types.ts, extended state machine transitions"
  - phase: 02-03
    provides: "RmaService base (Phase 2 methods), RmaRepository base, established fetch→validate→$transaction pattern"
provides:
  - "RmaService.contest() — REJECTED→CONTESTED with one-contest-per-RMA guard"
  - "RmaService.overturn() — CONTESTED→APPROVED with contestResolutionNote"
  - "RmaService.uphold() — CONTESTED→CLOSED with contestResolutionNote"
  - "RmaService.splitLine() — atomic delete+createMany with quantity conservation guard"
  - "RmaService.approveLineCredit() — CREDIT line Finance approval"
  - "RmaService.resolve() — Finance approval hard-block guard"
  - "RmaService.updateLine() — clears financeApprovedAt on non-CREDIT disposition change"
  - "RmaService.recordQcInspection() — stores qcPass, qcFindings, qcDispositionRecommendation"
  - "RmaRepository.findForApprovalQueue() — SUBMITTED+CONTESTED queue with FIFO ordering and branch scoping"
  - "RmaRepository.findCreditApprovalLines() — unapproved CREDIT lines on QC_COMPLETE RMAs"
affects: [03-03-controllers, 03-04-tests, phase-04, phase-05-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Finance approval hard-block: resolve() filters unapprovedCreditLines before $transaction"
    - "Finance approval clear-on-change: updateLine() uses clearFinanceApproval flag + second tx.rmaLine.update()"
    - "Atomic line split: tx.rmaLine.delete() + tx.rmaLine.createMany() in single $transaction, quantity conservation pre-checked before tx"
    - "One-contest guard: service-layer check on rma.contestedAt before assertValidTransition"
    - "Queue method with branch scoping: branchScopeWhere(user) as base, optional branchId narrows if user owns it"

key-files:
  created: []
  modified:
    - rms-api/src/rma/rma.service.ts
    - rms-api/src/rma/rma.repository.ts

key-decisions:
  - "recordQcInspection() uses RecordQcInspectionInput (Phase 3 type) — inline tx.rmaLine.update() replaces repository updateLineQc() call to support new QC result fields without changing repository method signature"
  - "findForApprovalQueue() uses submittedBy relation join (Rma has submittedBy User relation in schema) — submittedByName and submittedByEmail populated from DB, not deferred to controller"
  - "splitLine() pre-checks quantity conservation before $transaction() — TOCTOU safe; guard on totalSplitQty !== line.orderedQty is deterministic"
  - "clearFinanceApproval is a second tx.rmaLine.update() inside updateLine() transaction — kept separate from rmaRepository.updateLine() to avoid making repository Finance-aware"

patterns-established:
  - "All 5 new service methods follow: optional guard → fetch → assertValidTransition → $transaction(updateRma + logEvent + findById)"
  - "Queue repository methods always call branchScopeWhere(user) first — ownership never optional"

requirements-completed: [WKFL-01, WKFL-02, WKFL-03, WKFL-04, WKFL-05, LINE-04]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 03 Plan 02: Service Methods and Repository Queues Summary

**5 new RmaService methods (contest/overturn/uphold/splitLine/approveLineCredit) + resolve/updateLine/recordQcInspection extensions + 2 new RmaRepository queue queries with branch-scoped ownership enforcement**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T21:53:06Z
- **Completed:** 2026-02-27T21:56:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- All 5 new service methods implemented following Phase 2 fetch→validate→$transaction pattern
- Finance approval hard-block in resolve() prevents resolving without all CREDIT lines approved
- updateLine() now clears Finance approval when disposition changes away from CREDIT
- recordQcInspection() extended to accept qcPass, qcFindings, qcDispositionRecommendation
- findForApprovalQueue() returns SUBMITTED+CONTESTED queue with FIFO ordering, submittedBy relation join, and branch-scoped filtering
- findCreditApprovalLines() returns unapproved CREDIT lines on QC_COMPLETE RMAs with branch scoping
- 41/41 Phase 2 unit tests still passing — zero regression

## Task Commits

Each task was committed atomically:

1. **Task 1: Add contest/overturn/uphold/splitLine/approveLineCredit + modify resolve/updateLine/recordQcInspection** - `d434ae3` (feat)
2. **Task 2: Add findForApprovalQueue and findCreditApprovalLines to RmaRepository** - `86f6d7b` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `rms-api/src/rma/rma.service.ts` - Added 5 new methods; modified resolve(), updateLine(), recordQcInspection(); added DispositionType import
- `rms-api/src/rma/rma.repository.ts` - Added findForApprovalQueue() and findCreditApprovalLines(); added branchScopeWhere/RmsUserContext/DispositionType imports

## Decisions Made
- `recordQcInspection()` uses inline `tx.rmaLine.update()` rather than calling `rmaRepository.updateLineQc()` — necessary because the Phase 3 QC fields (qcPass, qcFindings, qcDispositionRecommendation) need to be conditionally applied and the repository method only accepts inspectedQty
- `findForApprovalQueue()` uses `submittedBy` Prisma relation join (available in schema) rather than deferring to controller — saves a round-trip and delivers names directly
- `clearFinanceApproval` runs as a second `tx.rmaLine.update()` inside `updateLine()`'s transaction rather than merging into `rmaRepository.updateLine()` — keeps repository Finance-unaware
- One-contest guard is a service-layer check on `rma.contestedAt` before `assertValidTransition()` — state machine alone cannot express "first time only" constraints

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — build passed on first attempt. The `RecordQcInspectionInput.lineId` field is declared as required in rma.types.ts but the service method takes `lineId` as a separate parameter (making it redundant in the input); integration tests pass `{ inspectedQty: N }` without a `lineId` field. TypeScript structural typing allows this (the field is present as a separate parameter, not the input object) so no TypeScript error occurs. The service method uses `lineId` from its own parameter, not from `input.lineId`, so no behavioral issue arises.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Service layer complete — all Phase 3 business logic is implemented
- Controllers (Plan 03) can be thin wrappers calling these methods
- Repository queue methods ready for controller injection
- 41/41 Phase 2 unit tests passing confirms no regression
- No blockers for Phase 3 Plan 03

## Self-Check: PASSED

- rms-api/src/rma/rma.service.ts: FOUND
- rms-api/src/rma/rma.repository.ts: FOUND
- .planning/phases/03-workflow-and-line-operations/03-02-SUMMARY.md: FOUND
- Commit d434ae3 (Task 1): FOUND
- Commit 86f6d7b (Task 2): FOUND

---
*Phase: 03-workflow-and-line-operations*
*Completed: 2026-02-27*
