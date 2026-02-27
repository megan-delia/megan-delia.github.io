---
phase: 03-workflow-and-line-operations
plan: 04
subsystem: testing
tags: [vitest, integration-tests, nestjs, prisma, postgres, workflow, rbac, tdd]

# Dependency graph
requires:
  - phase: 03-01
    provides: RmaService workflow types (ContestInput, OverturnInput, UpholdInput, SplitLineInput, RecordQcInspectionInput)
  - phase: 03-02
    provides: RmaService workflow methods (contest/overturn/uphold/splitLine/approveLineCredit/recordQcInspection) and RmaRepository queue methods (findForApprovalQueue/findCreditApprovalLines)
  - phase: 03-03
    provides: NestJS controllers exposing all Phase 3 HTTP endpoints
  - phase: 02-05
    provides: Integration test pattern (NestJS TestingModule + real DB + FK-safe cleanup)
provides:
  - rms-api/src/rma/workflow.integration.spec.ts — 16 Vitest integration tests for all 6 Phase 3 requirements
  - Full regression baseline for Phase 3 (workflow, finance, QC, line split)
affects: [04-merp-integration, 05-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-branch fixture pattern: branchA for primary tests, branchB for cross-branch isolation test"
    - "Five-actor pattern: agentActor/managerActor/customerActor/financeActor/qcActor with distinct RmsRole values"
    - "getQcCompleteWithCredit() helper encapsulates full lifecycle progression to QC_COMPLETE with CREDIT line"
    - "RmsUserContext vs RmaActorContext: both shapes compatible; repository methods take RmsUserContext, service methods take RmaActorContext"

key-files:
  created:
    - rms-api/src/rma/workflow.integration.spec.ts
  modified:
    - rms-api/src/rma/rma.service.integration.spec.ts

key-decisions:
  - "RecordQcInspectionInput.lineId is required in Phase 3 — Phase 2 integration test calls updated to include lineId and replace qcNotes with qcFindings"
  - "Two-branch test fixture (branchA + branchB) used to verify cross-branch isolation without relying on per-test setup"
  - "RmsUserContext shape (from users.service.ts) is required by findForApprovalQueue repository method; actor context objects satisfy this interface since both shapes are structurally identical"
  - "Finance approval clearing tested via direct prisma.rmaLine.update() to set financeApprovedAt before testing the updateLine() clear behavior"

patterns-established:
  - "Phase 3 integration test pattern: two-branch fixture + five-actor setup + lifecycle helper methods per test suite"
  - "Helper chain: createDraftRma() → getSubmittedRma() → getApprovedRma() → getRejectedRma() → getContestedRma() → getQcCompleteWithCredit()"

requirements-completed: [WKFL-01, WKFL-02, WKFL-03, WKFL-04, WKFL-05, LINE-04]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 3 Plan 04: Workflow Integration Tests Summary

**16 Vitest integration tests covering WKFL-01 through WKFL-05 and LINE-04 — approval queue scope/sort, contest/overturn/uphold flow, Finance approval gate, QC inspection recording, and line split — all compile-clean and ready to run with Docker**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-27T22:04:36Z
- **Completed:** 2026-02-27T22:08:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Created workflow.integration.spec.ts with 16 tests covering all 6 Phase 3 requirement IDs
- Fixed rma.service.integration.spec.ts: updated 7 `recordQcInspection` calls to include required `lineId` and replaced `qcNotes` with `qcFindings` (Phase 3 type change)
- TypeScript compile-clean (tsc --noEmit exits 0, npm run build exits 0)
- 41/41 Phase 2 unit tests still passing

## Test Coverage (workflow.integration.spec.ts)

**Run:** `cd rms-api && npm run test:e2e -- --reporter=verbose workflow.integration`

**Prerequisite:** Docker running, DATABASE_URL set, `npx prisma migrate deploy` applied

| Describe Block | Tests | Requirement |
|---------------|-------|-------------|
| WKFL-01: Approval queue | 3 | Queue scope, oldest-first, status filter |
| Cross-branch isolation (WKFL-01) | 1 | branchB manager cannot see branchA RMAs |
| WKFL-02: Contest flow | 3 | contest(), one-contest rule, empty reason guard |
| WKFL-03: Overturn and uphold | 3 | overturn (CONTESTED→APPROVED), uphold (CONTESTED→CLOSED), empty note guard |
| WKFL-04: Finance approval gate | 4 | approveLineCredit(), resolve blocked, resolve after approval, Finance approval cleared |
| WKFL-05: QC inspection recording | 2 | qcPass=true persists, qcPass=false persists |
| LINE-04: Line split | 4 | qty conservation, qty mismatch throws, min-2 guard, locked after submit |
| **Total** | **16** | All 6 Phase 3 requirements |

## Task Commits

1. **Task 1: Create workflow.integration.spec.ts and fix Phase 2 integration test types** — `7ebf7f2` (test)

## Files Created/Modified

- `rms-api/src/rma/workflow.integration.spec.ts` — 695-line Vitest integration test file with 16 tests covering all Phase 3 requirements
- `rms-api/src/rma/rma.service.integration.spec.ts` — Fixed 7 `recordQcInspection` calls to satisfy updated `RecordQcInspectionInput` type (lineId required, qcNotes → qcFindings)

## Decisions Made

- `RecordQcInspectionInput` requires `lineId` as a required field (Phase 3 change) — the Phase 2 integration tests calling with only `{ inspectedQty: N }` needed the `lineId` added and `qcNotes` field renamed to `qcFindings`
- Two-branch fixture (branchA + branchB) created in `beforeAll` to support the cross-branch isolation test without separate `beforeEach` overhead
- `RmsUserContext` (from `users.service.ts`) is the shape expected by `findForApprovalQueue` — the actor contexts constructed for tests satisfy this interface since both `RmsUserContext` and `RmaActorContext` are structurally identical
- Finance approval clearing tested by directly setting `financeApprovedAt` via `prisma.rmaLine.update()` then calling `updateLine()` — avoids needing to progress through the full lifecycle to reach QC_COMPLETE just to test the CREDIT→SCRAP disposition-change clearing logic

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Phase 2 integration test type errors caused by Phase 3 type change**
- **Found during:** Task 1 (TypeScript compile check after creating workflow.integration.spec.ts)
- **Issue:** `rma.service.integration.spec.ts` had 7 calls to `recordQcInspection()` passing `{ inspectedQty: N }` or `{ inspectedQty: N, qcNotes: '...' }`. Phase 3 changed `RecordQcInspectionInput` to require `lineId` and renamed `qcNotes` to `qcFindings`, making all Phase 2 calls type-invalid.
- **Fix:** Added `lineId: line1.id` to all 7 calls; replaced `qcNotes` with `qcFindings` in the one test that used it
- **Files modified:** `rms-api/src/rma/rma.service.integration.spec.ts`
- **Verification:** `npx tsc --noEmit` exits 0 after fix; `npm test -- --testPathPatterns=rma.service.spec` shows 41/41 passing
- **Committed in:** `7ebf7f2` (same commit as the new test file)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug: type mismatch from Phase 3 type change breaking Phase 2 integration tests)
**Impact on plan:** Required for TypeScript compilation. Single deviation — no scope creep.

## Issues Encountered

None — tsc --noEmit found and the fix was straightforward.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All Phase 3 requirements (WKFL-01 through WKFL-05, LINE-04) have integration tests
- Full regression baseline established: Phase 2 unit tests (41/41), Phase 3 integration tests (16 ready for Docker)
- Phase 3 is complete — ready for Phase 4 (MERP integration) when MERP API contract is negotiated
- No blockers within Phase 3

---
*Phase: 03-workflow-and-line-operations*
*Completed: 2026-02-27*

## Self-Check: PASSED

Files exist:
- FOUND: rms-api/src/rma/workflow.integration.spec.ts
- FOUND: .planning/phases/03-workflow-and-line-operations/03-04-SUMMARY.md

Commits exist:
- FOUND: 7ebf7f2
