---
phase: 02-core-rma-lifecycle
plan: 02
subsystem: rma-core
tags: [typescript, state-machine, repository, prisma, nestjs]

# Dependency graph
requires:
  - phase: 02-core-rma-lifecycle
    plan: 01
    provides: "Rma/RmaLine Prisma models, RmaStatus enum, rma.types.ts service contracts"
provides:
  - "ALLOWED_TRANSITIONS const map — single authoritative state machine for all RMA transitions"
  - "assertValidTransition() guard — called at top of every RmaService lifecycle method before DB write"
  - "RmaRepository — all Prisma DB operations for Rma and RmaLine records"
  - "RmaWithLines type — full Rma record with lines included"
affects: [02-03-rma-service, 02-04-line-service, 02-05-receipt-qc, 02-06-rma-controller]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "State machine as pure TypeScript const — no DI, no Prisma, testable with zero setup"
    - "assertValidTransition() throws BadRequestException with structured body including allowedTransitions array"
    - "Repository mutation methods accept Prisma.TransactionClient — service owns the transaction boundary"
    - "Repository never calls $transaction() — prevents nested transaction pitfall"
    - "All @Injectable() constructors use @Inject(Token) — esbuild/Vitest DI constraint"
    - "RmaWithLines type alias via Prisma.RmaGetPayload — type-safe include inference"

key-files:
  created:
    - rms-api/src/rma/rma-lifecycle.ts
    - rms-api/src/rma/rma.repository.ts

key-decisions:
  - "ALLOWED_TRANSITIONS covers all 10 RmaStatus keys — TypeScript enforces completeness at compile time"
  - "Terminal states (REJECTED, CANCELLED, CLOSED) have empty arrays — no outgoing transitions possible"
  - "LCYC-11 implemented: DRAFT, SUBMITTED, APPROVED, INFO_REQUIRED all include CANCELLED as outgoing transition"
  - "Repository reads (findById, generateRmaNumber) use this.prisma directly — outside transaction"
  - "Repository mutations accept tx param — service passes transaction client, preventing nested transactions"

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 2 Plan 02: RMA Lifecycle and Repository Summary

**State machine transition map (pure TypeScript const) and RMA repository (all Prisma DB operations) implemented — foundational data layer for all RmaService methods**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-27T20:47:45Z
- **Completed:** 2026-02-27T20:50:22Z
- **Tasks:** 2/2
- **Files created:** 2

## Accomplishments

- Created `rma-lifecycle.ts` with `ALLOWED_TRANSITIONS` covering all 10 RmaStatus values and `assertValidTransition()` guard
- LCYC-11 implemented: DRAFT, SUBMITTED, APPROVED, and INFO_REQUIRED all include CANCELLED as an allowed outgoing transition
- Terminal states (REJECTED, CANCELLED, CLOSED) have empty arrays — no outgoing transitions
- Created `rma.repository.ts` with all 10 repository methods, using `@Inject(PrismaService)` on the constructor (esbuild/Vitest DI constraint)
- `RmaWithLines` type exported via `Prisma.RmaGetPayload` for type-safe include inference
- TypeScript build passes with zero errors; `npm run build` exits 0

## ALLOWED_TRANSITIONS Map Summary

| From State    | Allowed Outgoing Transitions                                    |
|---------------|-----------------------------------------------------------------|
| DRAFT         | SUBMITTED, CANCELLED                                            |
| SUBMITTED     | APPROVED, REJECTED, INFO_REQUIRED, CANCELLED                   |
| INFO_REQUIRED | SUBMITTED (resubmit), CANCELLED                                 |
| APPROVED      | RECEIVED, CANCELLED                                             |
| RECEIVED      | QC_COMPLETE                                                     |
| QC_COMPLETE   | RESOLVED                                                        |
| RESOLVED      | CLOSED                                                          |
| REJECTED      | (empty — terminal)                                              |
| CANCELLED     | (empty — terminal)                                              |
| CLOSED        | (empty — terminal)                                              |

## Repository Methods Created

| Method              | Signature                                              | Notes                                    |
|---------------------|--------------------------------------------------------|------------------------------------------|
| `findById`          | `(id) => RmaWithLines \| null`                        | Reads outside tx; returns null not throws |
| `generateRmaNumber` | `() => string`                                        | RMA-YYYYMM-NNNNNN; reads outside tx      |
| `createRma`         | `(tx, data) => RmaWithLines`                          | Nested lines create in single write      |
| `updateStatus`      | `(tx, rmaId, status) => void`                         | Status-only update                       |
| `updateRma`         | `(tx, rmaId, data: RmaUpdateInput) => void`           | Multi-field update (rejectionReason etc.)|
| `addLine`           | `(tx, rmaId, line) => void`                           | Add line to existing RMA                 |
| `updateLine`        | `(tx, lineId, data) => void`                          | Undefined-skip pattern for partial edits |
| `removeLine`        | `(tx, lineId) => void`                                | Delete line record                       |
| `updateLineReceipt` | `(tx, lineId, receivedQty) => void`                  | Update received qty; over-receipt allowed |
| `updateLineQc`      | `(tx, lineId, inspectedQty) => void`                 | Sets inspectedQty + qcInspectedAt        |

## Confirmations

- **@Inject pattern:** `@Inject(PrismaService)` applied on the single constructor parameter of `RmaRepository`
- **No nested transactions:** `$transaction` appears only in JSDoc comments — never called in executable code
- **TypeScript build:** `npx tsc --noEmit` and `npm run build` both pass with zero errors

## Task Commits

1. **Task 1: Create rma-lifecycle.ts** - `e666989` (feat)
2. **Task 2: Create rma.repository.ts** - `42f6a9b` (feat)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `rms-api/src/rma/rma-lifecycle.ts` — FOUND
- `rms-api/src/rma/rma.repository.ts` — FOUND
- Commit `e666989` — FOUND
- Commit `42f6a9b` — FOUND
- `npx tsc --noEmit` — zero errors
- `npm run build` — exits 0
- ALLOWED_TRANSITIONS has 10 keys — VERIFIED
- Terminal states (REJECTED, CANCELLED, CLOSED) have `[]` — VERIFIED
- `@Inject(PrismaService)` on constructor — VERIFIED (line 12)
- No `$transaction()` call in repository body — VERIFIED
