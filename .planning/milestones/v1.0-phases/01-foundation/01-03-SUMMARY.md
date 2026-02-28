---
phase: 01-foundation
plan: 03
subsystem: audit, integration
tags: [nestjs, prisma, typescript, audit-log, merp, di-pattern]

# Dependency graph
requires:
  - phase: 01-foundation/01-01
    provides: Prisma schema with AuditEvent and MerpIntegrationLog models, PrismaService, generated Prisma client
  - phase: 01-foundation/01-02
    provides: AppModule structure with global JWT guard pattern

provides:
  - AuditService.logEvent(tx, input) — enforces atomic audit writes inside transactions
  - AuditAction const object with 22 lifecycle event keys
  - AuditEventInput interface matching AuditEvent schema
  - MerpAdapter abstract class as NestJS DI injection token
  - MerpStubAdapter returning typed MerpResult{status:'STUB'}, logging every call to MerpIntegrationLog
  - CreditMemoPayload, ReplacementOrderPayload, MerpResult typed contracts
  - AuditModule and MerpModule wired into final Phase 1 AppModule

affects:
  - Phase 2+ services that perform RMA state transitions (must use logEvent inside $transaction)
  - Phase 2+ MERP triggering (inject MerpAdapter token, not MerpStubAdapter)
  - v2 live MERP integration (implement MerpAdapter abstract class, swap useClass in MerpModule)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Transaction-enforced audit: logEvent(tx, input) signature prevents out-of-transaction audit writes"
    - "Abstract class as DI token: MerpAdapter is abstract class (not interface) so NestJS DI can resolve it"
    - "Stub-first integration: MerpStubAdapter implements full interface contract so v2 live adapter is drop-in replacement"
    - "Const-object enums: AuditAction is const object (not Prisma enum) — avoids DB migrations for new action types"

key-files:
  created:
    - rms-api/src/audit/audit.types.ts
    - rms-api/src/audit/audit.service.ts
    - rms-api/src/audit/audit.module.ts
    - rms-api/src/merp/merp.types.ts
    - rms-api/src/merp/merp-adapter.interface.ts
    - rms-api/src/merp/merp-stub.adapter.ts
    - rms-api/src/merp/merp.module.ts
  modified:
    - rms-api/src/app.module.ts

key-decisions:
  - "logEvent(tx) tx parameter is enforced at the type level — no tx-less overload exists, any caller without a transaction cannot compile"
  - "AuditAction is a const object (not Prisma enum) — new actions can be added without DB migrations"
  - "MerpAdapter is abstract class (not TypeScript interface) — required for NestJS DI token resolution"
  - "MERP payload shapes (CreditMemoPayload, ReplacementOrderPayload) are provisional — must be validated with MERP team before v2 live integration"
  - "PrismaModule is @Global() so MerpModule does not need to import it explicitly"

patterns-established:
  - "Atomic audit pattern: all Phase 2+ state changes must call logEvent(tx, ...) inside $transaction()"
  - "MERP injection: services inject MerpAdapter token — never MerpStubAdapter directly"

requirements-completed: [FOUND-04, FOUND-05]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 1 Plan 03: Audit Service and MERP Adapter Summary

**Transaction-enforced AuditService with typed MERP adapter interface, v1 stub that logs every call to MerpIntegrationLog, and complete Phase 1 AppModule**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T18:26:28Z
- **Completed:** 2026-02-27T18:29:15Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- AuditService.logEvent(tx, input) enforces Prisma.TransactionClient at the type level — audit can only be called inside a transaction
- AuditAction const object with 22 lifecycle event keys (RMA lifecycle, line operations, MERP events, user provisioning)
- MerpAdapter abstract class + MerpStubAdapter returning typed MerpResult{status:'STUB'}, logging to MerpIntegrationLog on every call
- DI token pattern ({provide: MerpAdapter, useClass: MerpStubAdapter}) enables zero-change v2 live adapter swap
- Final Phase 1 AppModule includes all modules: PrismaModule, UsersModule, AuthModule, AuditModule, MerpModule

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement AuditService with atomic logEvent pattern** - `b5346e6` (feat)
2. **Task 2: Implement MERP adapter interface, stub, and wire into AppModule** - `30f95e7` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `rms-api/src/audit/audit.types.ts` - AuditAction const object (22 keys) and AuditEventInput interface
- `rms-api/src/audit/audit.service.ts` - AuditService with logEvent(tx: Prisma.TransactionClient, input) enforcing atomic writes
- `rms-api/src/audit/audit.module.ts` - AuditModule exporting AuditService
- `rms-api/src/merp/merp.types.ts` - CreditMemoPayload, ReplacementOrderPayload, MerpResult typed contracts
- `rms-api/src/merp/merp-adapter.interface.ts` - MerpAdapter abstract class as NestJS DI token
- `rms-api/src/merp/merp-stub.adapter.ts` - MerpStubAdapter returning MerpResult{status:'STUB'}, logging to MerpIntegrationLog
- `rms-api/src/merp/merp.module.ts` - MerpModule with DI token {provide: MerpAdapter, useClass: MerpStubAdapter}
- `rms-api/src/app.module.ts` - Final Phase 1 state: all modules registered

## Decisions Made

- **Tx enforcement via type signature:** logEvent(tx: Prisma.TransactionClient, ...) is the design fence. No tx-less overload exists. Any caller without a transaction will fail TypeScript compilation.
- **Const object for AuditAction:** Using `as const` object instead of Prisma/DB enum means new action types require only a TypeScript addition — no DB migration needed.
- **Abstract class as DI token:** TypeScript interfaces are erased at runtime; abstract classes survive. NestJS DI requires a runtime-resolvable token, so MerpAdapter must be abstract class.
- **MERP payload shapes are provisional:** CreditMemoPayload and ReplacementOrderPayload are based on standard electronics distribution domain knowledge. These MUST be validated against actual MERP API spec before v2 live integration begins.
- **PrismaModule is @Global():** MerpModule does not need to import PrismaModule because it is globally registered. MerpStubAdapter receives PrismaService via constructor injection automatically.

## Open Questions / Flags

**MERP API contract must be validated with MERP team before v2 live integration:**
The payload shapes in `merp.types.ts` (field names, nesting, unitCost as cents vs decimal, exact error codes) are based on domain knowledge — NOT confirmed with the MERP team. Before implementing MerpLiveAdapter (v2), negotiate the actual MERP API request/response schema and update these types if needed.

## Deviations from Plan

None — plan executed exactly as written. The only adaptation was noting that PrismaModule is @Global() so the PrismaModule import in MerpModule was unnecessary and removed for cleanliness.

## Issues Encountered

None — TypeScript build passed on first attempt for all audit and MERP files.

## User Setup Required

None — no external service configuration required. MerpStubAdapter bypasses actual MERP API calls entirely.

## Next Phase Readiness

- AuditService ready for use in Phase 2 RMA state transitions — inject AuditService, call logEvent(tx, ...) inside $transaction()
- MerpAdapter ready for Phase 2 MERP triggering — inject MerpAdapter token, call createCreditMemo() or createReplacementOrder()
- Full Phase 1 foundation complete: Prisma schema, PrismaService, auth guards, user service, audit service, MERP stub all in place
- Blockers before Phase 2: Docker Desktop must be installed and `npx prisma migrate dev --name init-foundation` must run to create DB tables

## Self-Check: PASSED

All 9 files confirmed to exist on disk. Both task commits (b5346e6, 30f95e7) confirmed in git log. TypeScript build passed (zero "error TS" lines). All plan verification checks passed:
- Prisma.TransactionClient in logEvent signature: confirmed
- status: 'STUB' in MerpStubAdapter: 2 matches (one per method)
- merpIntegrationLog.create: 2 matches (one per method)
- DI token { provide: MerpAdapter, useClass: MerpStubAdapter }: confirmed
- AuditAction entries: 33 colon-delimited entries (exceeds 20+ requirement)

---
*Phase: 01-foundation*
*Completed: 2026-02-27*
