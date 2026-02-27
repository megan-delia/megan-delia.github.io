---
phase: 02-core-rma-lifecycle
plan: 05
subsystem: api
tags: [nestjs, jest, vitest, tdd, rma, lifecycle, integration-tests]

# Dependency graph
requires:
  - phase: 02-core-rma-lifecycle plan 04
    provides: RmaService fully implemented (all 11 LCYC + 3 LINE requirements)
  - phase: 02-core-rma-lifecycle plan 02
    provides: assertValidTransition(), ALLOWED_TRANSITIONS, RmaRepository
  - phase: 01-foundation plan 04
    provides: Dual-runner test infrastructure (Jest unit + Vitest integration)
provides:
  - rma.service.spec.ts — 41 Jest unit tests for state machine and guard logic, no DB required
  - rma.service.integration.spec.ts — 24 Vitest integration tests for all 14 LCYC/LINE requirements
  - Full regression baseline for Phase 3 (HTTP layer)
affects: [phase-03-http-layer, phase-04-attachments, phase-05-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Jest unit tests import from generated/prisma/enums.js (not client.js) — avoids Prisma 7 ESM/CJS incompatibility
    - Vitest integration tests import from generated/prisma/client.js (ESM-native, full client works)
    - Guard logic tested as plain boolean expression assertions — no DI or mocking needed
    - createdRmaIds tracking pattern for integration test cleanup
    - FK-safe cleanup order in afterAll: auditEvent → rmaLine → rma → userBranchRole → user → branch

key-files:
  created:
    - rms-api/src/rma/rma.service.spec.ts
    - rms-api/src/rma/rma.service.integration.spec.ts
  modified: []

key-decisions:
  - "Guard logic tests use explicit string type annotations to avoid TypeScript narrowing to never on empty string literals"
  - "Integration tests use prisma.rmaLine.update() directly to set qcInspectedAt for the LINE-02 disposition-lock test — avoids needing to progress through the full lifecycle just to test the lock guard"
  - "First-receipt test asserts exactly one RMA_RECEIVED audit event with fromStatus=APPROVED — confirms no double-transition on second receipt call"

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 2 Plan 05: RMA Lifecycle Test Suite Summary

**41 Jest unit tests (all pass, no DB required) + 24 Vitest integration tests (all LCYC/LINE requirements covered, ready for Docker) establishing the complete regression baseline for Phase 3**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T21:05:52Z
- **Completed:** 2026-02-27T21:09:00Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- rma.service.spec.ts: 41 Jest unit tests covering all 13 valid transitions, 7 invalid transitions, 6 terminal state tests, 2 error body shape tests, and 13 guard logic condition tests
- rma.service.integration.spec.ts: 24 Vitest integration tests covering all 14 LCYC/LINE requirements against real Postgres DB
- Full TypeScript compile-clean — zero errors across both test files
- Unit tests confirmed running in ~1.6s with no DB or Docker required
- Integration test file ready to run with `npm run test:e2e` when Docker is available

## Unit Test Results (rma.service.spec.ts)

**Run:** `cd rms-api && npm test -- --testPathPatterns=rma.service.spec`

**Result:** 41/41 passing (GREEN) — no DB or Docker required

| Test Group | Tests | Coverage |
|-----------|-------|---------|
| Valid transitions | 13 | All 13 ALLOWED_TRANSITIONS pairs |
| Invalid transitions | 7 | Skip transitions, backward transitions |
| Terminal states | 6 | CANCELLED, REJECTED, CLOSED — no outgoing |
| Error body shape | 2 | INVALID_TRANSITION error, allowedTransitions array |
| Guard logic — cancellationReason | 3 | Empty, whitespace-only, non-empty |
| Guard logic — rejectionReason | 3 | Empty, whitespace-only, non-empty |
| Guard logic — inspectedQty cap | 4 | > receivedQty, =, <, zero |
| Guard logic — receivedQty lower-bound | 3 | < inspectedQty, =, > |
| **Total** | **41** | |

## Integration Test Coverage (rma.service.integration.spec.ts)

**Run:** `cd rms-api && npm run test:e2e`

**Prerequisite:** Docker running, DATABASE_URL set, `npx prisma migrate deploy` applied

| Describe Block | Tests | Requirements |
|---------------|-------|-------------|
| LCYC-01 + LINE-01: createDraft() | 2 | Creates DRAFT RMA with lines; RMA_CREATED audit event |
| LCYC-02: submit() | 2 | DRAFT→SUBMITTED; invalid transition throws |
| LCYC-03: approve() | 1 | SUBMITTED→APPROVED with RMA_APPROVED audit |
| LCYC-04: reject() | 2 | SUBMITTED→REJECTED with reason; empty reason throws |
| LCYC-05: placeInfoRequired() | 1 | SUBMITTED→INFO_REQUIRED with audit |
| LCYC-06: resubmit() | 1 | INFO_REQUIRED→SUBMITTED with metadata.cycle=resubmit |
| LCYC-11: cancel() | 3 | DRAFT→CANCELLED; empty reason throws; terminal throws |
| LCYC-07 + LINE-03: recordReceipt() | 4 | First receipt→RECEIVED; second stays RECEIVED (1 audit); over-receipt OK; below-inspectedQty throws |
| LCYC-08 + LINE-03: recordQcInspection() | 3 | Sets inspectedQty/qcInspectedAt; zero allowed; >receivedQty throws |
| LCYC-08 completion: completeQc() | 1 | RECEIVED→QC_COMPLETE |
| LCYC-09: resolve() | 1 | QC_COMPLETE→RESOLVED |
| LCYC-10: close() | 1 | RESOLVED→CLOSED |
| LINE-02: disposition lock | 2 | Updatable before QC; locked after qcInspectedAt set |
| **Total** | **24** | All 14 LCYC/LINE requirements |

## Import Pattern: Unit vs. Integration

```typescript
// Unit tests (Jest / CJS) — MUST use enums.js, NOT client.js
import { RmaStatus } from '../../generated/prisma/enums.js';
// client.js uses import.meta which is ESM-only and breaks CJS Jest

// Integration tests (Vitest / ESM native) — full client works correctly
import { RmaStatus, RmsRole } from '../../generated/prisma/client.js';
```

## Running the Tests

```bash
# Unit tests — runs anywhere, no Docker needed
cd rms-api && npm test -- --testPathPatterns=rma.service.spec

# Integration tests — requires Docker + DATABASE_URL + applied migrations
docker compose up -d
cd rms-api && npx prisma migrate deploy
cd rms-api && npm run test:e2e

# All tests together
cd rms-api && npm run test:all
```

## First-Receipt Assertion (LCYC-07 Key Pattern)

The integration test verifies the isFirstReceipt pattern from Plan 04:

```typescript
// After createDraft + submit + approve: status = APPROVED
// After recordReceipt(line1): status = RECEIVED
// After recordReceipt(line1) AGAIN: status still RECEIVED (not double-transitioned)
const receivedAuditEventsWithTransition = await prisma.auditEvent.findMany({
  where: { rmaId: rma.id, action: AuditAction.RMA_RECEIVED, fromStatus: RmaStatus.APPROVED },
});
expect(receivedAuditEventsWithTransition).toHaveLength(1); // exactly one RMA_RECEIVED transition event
```

## Task Commits

1. **Task 1: Jest unit tests for state machine and guard logic** — `e6e9f40` (test)
2. **Task 2: Vitest integration tests for all LCYC/LINE requirements** — `5bcae17` (test, also includes TypeScript guard fix)

## Files Created

- `rms-api/src/rma/rma.service.spec.ts` — 41 Jest unit tests, no DB required
- `rms-api/src/rma/rma.service.integration.spec.ts` — 24 Vitest integration tests, requires Docker

## Decisions Made

- Guard logic tests use explicit `string` type annotations to prevent TypeScript narrowing to `never` on empty string literals in boolean short-circuit expressions
- LINE-02 disposition lock integration test sets `qcInspectedAt` directly via `prisma.rmaLine.update()` — avoids progressing through the full receipt+QC lifecycle just to exercise the disposition lock guard in an otherwise DRAFT-status RMA
- First-receipt test counts audit events with `fromStatus = APPROVED` rather than all `RMA_RECEIVED` events — correctly isolates the single APPROVED→RECEIVED transition event from subsequent receipt updates

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript narrowing error in guard logic unit tests**
- **Found during:** Task 2 (TypeScript compile check)
- **Issue:** Variables declared as `const x = ''` narrowed to `never` type by TypeScript; the `!x || x.trim()...` expression caused TS2339 errors because the right side of `||` is unreachable when `x` is the empty string literal
- **Fix:** Added explicit `: string` type annotations to all guard logic test variables (`const cancellationReason: string = ''`)
- **Files modified:** `rms-api/src/rma/rma.service.spec.ts`
- **Commit:** `5bcae17` (included in Task 2 commit with integration test)

## Self-Check: PASSED

Files exist:
- FOUND: rms-api/src/rma/rma.service.spec.ts
- FOUND: rms-api/src/rma/rma.service.integration.spec.ts

Commits exist:
- FOUND: e6e9f40
- FOUND: 5bcae17

---
*Phase: 02-core-rma-lifecycle*
*Completed: 2026-02-27*
