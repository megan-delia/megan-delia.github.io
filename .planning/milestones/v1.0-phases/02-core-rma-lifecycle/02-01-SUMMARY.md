---
phase: 02-core-rma-lifecycle
plan: 01
subsystem: database
tags: [prisma, postgresql, typescript, rma, schema]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "User, Branch, AuditEvent, MerpIntegrationLog models, RmsRole enum, PrismaService, generated/prisma client pattern"
provides:
  - "Rma and RmaLine Prisma models with full relation set"
  - "RmaStatus enum (10 states) and DispositionType enum (4 values) in schema.prisma"
  - "Generated Prisma client with typed Rma/RmaLine/RmaStatus/DispositionType exports"
  - "rma.types.ts with all service input contracts (CreateRmaInput, LineInput, UpdateLineInput, RecordReceiptInput, RecordQcInput, RejectRmaInput, CancelRmaInput, PlaceInfoRequiredInput, InvalidTransitionError, RmaActorContext)"
affects: [02-02-rma-service, 02-03-line-service, 02-04-receipt-qc, 02-05-rma-controller]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "rma.types.ts is the single source of truth for service method input shapes — no service method accepts untyped/any parameters"
    - "DispositionType re-exported from rma.types.ts so service consumers import from one place"
    - "RmaActorContext declared in rma.types.ts (not users.service.ts) to avoid circular imports"
    - "qcInspectedAt DateTime? is the per-line disposition lock trigger — service checks this, no DB constraint needed for v1"

key-files:
  created:
    - rms-api/src/rma/rma.types.ts
  modified:
    - rms-api/prisma/schema.prisma
    - rms-api/vitest.integration.config.ts

key-decisions:
  - "RMA number format: RMA-YYYYMM-NNNNNN sequential per month (service generates, not schema)"
  - "Over-receipt is allowed — receivedQty has no max constraint; service won't block over-receipt"
  - "Disposition nullable at submission — locked per-line only after qcInspectedAt IS NOT NULL"
  - "Lines editable only in DRAFT and INFO_REQUIRED states — all other states are locked"
  - "Cascade delete on RmaLine.rmaId — deleting an Rma removes its lines"
  - "RmaActorContext re-declared in rma.types.ts to avoid circular dependency with users.service.ts"

patterns-established:
  - "All Phase 2 service methods accept typed inputs from rma.types.ts — no service takes unknown/any parameters"
  - "Prisma relation naming: SubmittedRmas on User, RmaAuditEvents on AuditEvent for disambiguation"

requirements-completed: [LCYC-01, LCYC-02, LCYC-03, LCYC-04, LCYC-05, LCYC-06, LCYC-07, LCYC-08, LCYC-09, LCYC-10, LCYC-11, LINE-01, LINE-02, LINE-03]

# Metrics
duration: 5min
completed: 2026-02-27
---

# Phase 2 Plan 01: RMA Schema and Type Contracts Summary

**Prisma schema extended with Rma/RmaLine models and 2 enums; rma.types.ts establishes typed service contracts unblocking all Wave 2 plans**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-27T20:38:58Z
- **Completed:** 2026-02-27T20:44:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Extended schema.prisma with RmaStatus (10 states), DispositionType (4 values), Rma model, RmaLine model, and back-reference relations on User/Branch/AuditEvent
- Generated Prisma client with typed Rma/RmaLine/RmaStatus/DispositionType exports — `npx prisma validate` and `npx prisma generate` both pass
- Created rma.types.ts with 9 exported interfaces plus DispositionType re-export — provides typed input contract for all Phase 2 service methods
- TypeScript build passes with zero errors (pre-existing vitest singleFork bug fixed as Rule 1 deviation)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend Prisma schema with Rma and RmaLine models** - `d750e33` (feat)
2. **Task 2: Create rma.types.ts with all service input contracts** - `5992080` (feat)

## Files Created/Modified

- `rms-api/prisma/schema.prisma` - Added RmaStatus enum, DispositionType enum, Rma model, RmaLine model; added back-reference relations on User (submittedRmas), Branch (rmas), AuditEvent (rma)
- `rms-api/src/rma/rma.types.ts` - New file: RmaActorContext, LineInput, UpdateLineInput, RecordReceiptInput, RecordQcInput, CreateRmaInput, RejectRmaInput, CancelRmaInput, PlaceInfoRequiredInput, InvalidTransitionError; re-exports DispositionType
- `rms-api/vitest.integration.config.ts` - Removed invalid singleFork option (Rule 1 auto-fix)

## Decisions Made

- **RMA number format:** RMA-YYYYMM-NNNNNN — format set in schema comment, service responsible for generating unique numbers
- **Over-receipt:** Allowed — receivedQty is uncapped; no DB constraint; service can choose to warn but not block
- **Disposition lock trigger:** qcInspectedAt DateTime? on RmaLine — service checks IS NOT NULL to lock disposition; no DB trigger or constraint needed for v1
- **RmaActorContext location:** Declared in rma.types.ts to avoid circular import — same fields as RmsUserContext from users.service.ts, redeclared independently
- **Cascade delete:** RmaLine has onDelete: Cascade from Rma — deleting an RMA removes all its lines atomically

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing vitest.integration.config.ts singleFork error**
- **Found during:** Task 2 verification (`npm run build`)
- **Issue:** `singleFork: true` at top-level test config is not a valid Vitest 4.x option — TypeScript error prevented `npm run build` from passing (required by plan success criteria)
- **Fix:** Removed `singleFork: true` (Vitest 4 sequencing is controlled by `sequence: { concurrent: false }` which was already present; `pool: 'forks'` retained)
- **Files modified:** rms-api/vitest.integration.config.ts
- **Verification:** `npx tsc --noEmit` shows zero errors; `npm run build` exits 0
- **Committed in:** `5992080` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in pre-existing file)
**Impact on plan:** Required to meet the `npm run build` success criterion. No scope creep.

## Issues Encountered

- Windows/OneDrive EPERM error when `npx prisma generate` tried to rmdir the existing `generated/prisma/models` directory — resolved by removing the directory before regenerating (OneDrive file locking). Same EPERM occurred for `dist/` on the first `npm run build` attempt — cleared and rebuilt successfully.

## Next Phase Readiness

- Schema validated, Prisma client generated with Rma/RmaLine/RmaStatus/DispositionType types
- rma.types.ts provides typed service contracts for Plans 02-02, 02-03, 02-04, 02-05
- All Wave 2 plans (02-02 through 02-05) are now unblocked
- Migration is still deferred (Docker Desktop not available in this execution environment) — same constraint as Phase 1

---
*Phase: 02-core-rma-lifecycle*
*Completed: 2026-02-27*
