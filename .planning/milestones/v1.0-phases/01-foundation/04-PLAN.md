---
phase: 01-foundation
plan: 04
type: tdd
wave: 3
depends_on:
  - "02-PLAN"
  - "03-PLAN"
files_modified:
  - rms-api/src/auth/auth.e2e.spec.ts
  - rms-api/src/auth/branch-scope.spec.ts
  - rms-api/src/audit/audit.integration.spec.ts
  - rms-api/src/merp/merp-stub.spec.ts
  - rms-api/jest.config.ts
  - rms-api/jest-e2e.config.ts
autonomous: true
requirements:
  - FOUND-01
  - FOUND-02
  - FOUND-03
  - FOUND-04
  - FOUND-05

must_haves:
  truths:
    - "A valid portal JWT for a provisioned user passes the full guard chain — JwtAuthGuard + RmsAuthGuard"
    - "A valid portal JWT for an unprovisioned user returns 403 with a message, not 500"
    - "An invalid or expired portal JWT returns 401"
    - "A RETURNS_AGENT user at Branch A cannot access data scoped to Branch B — branchScopeWhere returns branch filter"
    - "An ADMIN user gets an empty branchScopeWhere — global visibility confirmed"
    - "AuditService.logEvent() called outside a Prisma.$transaction() throws or the design prevents it — confirmed by test"
    - "AuditService.logEvent() inside $transaction() writes an AuditEvent row — confirmed by test hitting real DB"
    - "MerpStubAdapter.createCreditMemo() returns MerpResult{status:'STUB'} and creates a MerpIntegrationLog row"
    - "MerpStubAdapter.createReplacementOrder() returns MerpResult{status:'STUB'} and creates a MerpIntegrationLog row"
  artifacts:
    - path: "rms-api/src/auth/auth.e2e.spec.ts"
      provides: "E2E tests for guard chain — valid JWT, unprovisioned JWT, invalid JWT, role restriction"
      exports: []
    - path: "rms-api/src/auth/branch-scope.spec.ts"
      provides: "Unit tests for branchScopeWhere() — Admin empty filter, non-Admin branch filter"
      exports: []
    - path: "rms-api/src/audit/audit.integration.spec.ts"
      provides: "Integration tests for AuditService.logEvent() — in-transaction write confirmed; row exists in DB after commit"
      exports: []
    - path: "rms-api/src/merp/merp-stub.spec.ts"
      provides: "Unit/integration tests for MerpStubAdapter — typed return, DB log row created"
      exports: []
  key_links:
    - from: "rms-api/src/auth/auth.e2e.spec.ts"
      to: "rms-api/src/auth/jwt-auth.guard.ts + rms-auth.guard.ts"
      via: "NestJS testing module with real guards against test DB"
      pattern: "JwtAuthGuard.*RmsAuthGuard"
    - from: "rms-api/src/audit/audit.integration.spec.ts"
      to: "rms-api/src/audit/audit.service.ts"
      via: "prisma.$transaction() call verifying atomicity"
      pattern: "\\$transaction"
---

<objective>
Write TDD tests that prove all five Phase 1 success criteria from ROADMAP.md. Every test runs against the real test database (not mocks) to confirm actual behavior, not just type compliance.

Purpose: These tests are the proof that Phase 1 is done. The ROADMAP defines five verifiable outcomes — this plan translates them into automated assertions. RED → GREEN → confirm.

Output: Four test files covering all five FOUND requirements. All tests pass. Phase 1 success criteria are confirmed by automation.
</objective>

<execution_context>
@C:/Users/megan.delia/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/megan.delia/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/01-01-SUMMARY.md
@.planning/phases/01-foundation/01-02-SUMMARY.md
@.planning/phases/01-foundation/01-03-SUMMARY.md

<interfaces>
<!-- Contracts to test against — executor implements tests, not these interfaces -->

From rms-api/src/users/users.service.ts:
```typescript
export interface RmsUserContext {
  id: string;
  portalUserId: string;
  email: string;
  role: RmsRole;
  branchIds: string[];
  isAdmin: boolean;
}

export function branchScopeWhere(user: RmsUserContext): Record<string, unknown>
// Returns {} for Admin; { branchId: { in: branchIds } } for others

export class UsersService {
  async findByPortalId(portalUserId: string): Promise<RmsUserContext | null>
  // Returns null for unprovisioned users — NEVER throws for null case
}
```

From rms-api/src/audit/audit.service.ts:
```typescript
export class AuditService {
  async logEvent(tx: Prisma.TransactionClient, input: AuditEventInput): Promise<void>
}
```

From rms-api/src/merp/merp-stub.adapter.ts:
```typescript
export class MerpStubAdapter extends MerpAdapter {
  async createCreditMemo(payload: CreditMemoPayload): Promise<MerpResult>
  async createReplacementOrder(payload: ReplacementOrderPayload): Promise<MerpResult>
}
// Both methods: create MerpIntegrationLog row AND return MerpResult{status:'STUB'}
```

From rms-api/src/auth/rms-auth.guard.ts:
```typescript
// Throws ForbiddenException when findByPortalId returns null
// Attaches rmsUser to request on success
```

Phase 1 ROADMAP success criteria to prove:
1. A Returns Agent authenticates via portal JWT without second login → JwtAuthGuard passes
2. Customer role cannot access Returns Agent endpoint → 403
3. Branch A user cannot retrieve Branch B RMA → 404 (not the record)
4. Every state change writes audit event in same transaction → atomicity test
5. MERP adapter interface compiles with typed contracts; stub returns structured mock → MerpResult{status:'STUB'}
</interfaces>
</context>

<feature>
  <name>Phase 1 Foundation — All five FOUND requirements verified</name>
  <files>
    rms-api/src/auth/auth.e2e.spec.ts
    rms-api/src/auth/branch-scope.spec.ts
    rms-api/src/audit/audit.integration.spec.ts
    rms-api/src/merp/merp-stub.spec.ts
    rms-api/jest.config.ts
    rms-api/jest-e2e.config.ts
  </files>
  <behavior>
    Test cases and expected I/O:

    === auth.e2e.spec.ts ===
    Setup: NestJS testing module with real PrismaService pointed at test DB.
    Seed data: One Branch (branchId='branch-a'), One provisioned User with RETURNS_AGENT role at branch-a, One provisioned User with CUSTOMER role at branch-a.

    Test 1 (FOUND-01): Valid portal JWT + provisioned Returns Agent
      - Generate JWT: { sub: user.portalUserId, email: user.email }
      - GET /test-auth with Authorization: Bearer <token>
      - Expected: 200 (guard chain passes; req.rmsUser attached)

    Test 2 (FOUND-01 negative): Valid portal JWT + unprovisioned user
      - Generate JWT for a portalUserId with NO user_branch_roles row
      - GET /test-auth with valid Bearer token
      - Expected: 403 response, body contains 'not provisioned'

    Test 3 (FOUND-01 negative): No JWT / invalid JWT
      - GET /test-auth with no Authorization header
      - Expected: 401 response

    Test 4 (FOUND-02): Role restriction — Customer cannot access Returns Agent endpoint
      - Generate JWT for Customer user
      - GET /test-agent-only with Customer JWT
      - Expected: 403 response

    Test 5 (FOUND-02): Role restriction — Returns Agent can access Returns Agent endpoint
      - Generate JWT for Returns Agent user
      - GET /test-agent-only with Returns Agent JWT
      - Expected: 200

    NOTE: Create a minimal TestController in the test file itself (not in src/) with:
      - GET /test-auth: @UseGuards(JwtAuthGuard, RmsAuthGuard), returns { rmsUserId: req.rmsUser.id }
      - GET /test-agent-only: @UseGuards(JwtAuthGuard, RmsAuthGuard, RolesGuard) @Roles('RETURNS_AGENT'), returns 200
    This avoids polluting production src/ with test endpoints.

    === branch-scope.spec.ts ===
    Pure unit tests — no DB needed.

    Test 1 (FOUND-03): Admin user gets empty WHERE clause
      - adminUser: RmsUserContext { role: RmsRole.ADMIN, branchIds: ['b1','b2'], isAdmin: true }
      - branchScopeWhere(adminUser) → {}
      - assert deepEqual({})

    Test 2 (FOUND-03): Returns Agent gets branch filter
      - agentUser: RmsUserContext { role: RmsRole.RETURNS_AGENT, branchIds: ['branch-a'], isAdmin: false }
      - branchScopeWhere(agentUser) → { branchId: { in: ['branch-a'] } }
      - assert deepEqual({ branchId: { in: ['branch-a'] } })

    Test 3 (FOUND-03): Multi-branch user gets multi-branch filter
      - managerUser: RmsUserContext { role: RmsRole.BRANCH_MANAGER, branchIds: ['branch-a','branch-b'], isAdmin: false }
      - branchScopeWhere(managerUser) → { branchId: { in: ['branch-a','branch-b'] } }
      - assert deepEqual({ branchId: { in: ['branch-a','branch-b'] } })

    === audit.integration.spec.ts ===
    Integration tests — uses real PrismaService and test DB.

    Setup: Seed one User row (actorId). Wrap each test in a transaction that rolls back after.

    Test 1 (FOUND-04): logEvent inside $transaction writes AuditEvent row
      - await prisma.$transaction(async (tx) => {
          await auditService.logEvent(tx, { actorId, actorRole: 'RETURNS_AGENT', action: AuditAction.RMA_CREATED });
        });
      - const row = await prisma.auditEvent.findFirst({ where: { actorId } });
      - assert row !== null
      - assert row.action === 'RMA_CREATED'
      - assert row.actorRole === 'RETURNS_AGENT'
      - assert row.occurredAt is a Date (server-set, not null)

    Test 2 (FOUND-04): State change + audit atomicity — if audit fails, state change rolls back
      - This test simulates the atomicity guarantee by verifying $transaction rollback behavior.
      - Create a transaction that writes a dummy record AND calls logEvent, then throws AFTER both writes.
      - Verify neither the dummy record NOR the audit event persists after the throw.
      - This proves both writes are in the same transaction (they both disappear on rollback).

    === merp-stub.spec.ts ===
    Integration tests — uses real PrismaService and test DB.

    Test 1 (FOUND-05): createCreditMemo returns typed MerpResult{status:'STUB'}
      - const result = await merpStubAdapter.createCreditMemo(creditMemoPayload)
      - assert result.success === true
      - assert result.status === 'STUB'
      - assert typeof result.referenceId === 'string'
      - assert result.referenceId starts with 'STUB-CM-'

    Test 2 (FOUND-05): createCreditMemo creates MerpIntegrationLog row
      - call createCreditMemo
      - const log = await prisma.merpIntegrationLog.findFirst({ where: { rmaId: creditMemoPayload.rmaId } })
      - assert log !== null
      - assert log.operationType === 'CREDIT_MEMO'
      - assert log.status === 'STUB'

    Test 3 (FOUND-05): createReplacementOrder returns typed MerpResult{status:'STUB'}
      - same pattern as Test 1 for replacement order
      - assert result.referenceId starts with 'STUB-RO-'

    Test 4 (FOUND-05): createReplacementOrder creates MerpIntegrationLog row
      - same pattern as Test 2 for replacement order
      - assert log.operationType === 'REPLACEMENT_ORDER'
  </behavior>
  <implementation>
    Step 1 — Configure Jest:

    Create rms-api/jest.config.ts for unit tests:
    ```typescript
    import type { Config } from 'jest';

    const config: Config = {
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: 'src',
      testRegex: '.*\\.spec\\.ts$',
      transform: { '^.+\\.(t|j)s$': 'ts-jest' },
      coverageDirectory: '../coverage',
      testEnvironment: 'node',
    };

    export default config;
    ```

    Create rms-api/jest-e2e.config.ts for e2e/integration tests:
    ```typescript
    import type { Config } from 'jest';

    const config: Config = {
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: '.',
      testRegex: '.e2e.spec.ts$|.integration.spec.ts$',
      transform: { '^.+\\.(t|j)s$': 'ts-jest' },
      testEnvironment: 'node',
    };

    export default config;
    ```

    Update rms-api/package.json scripts to add:
    ```json
    "test": "jest --config jest.config.ts",
    "test:e2e": "jest --config jest-e2e.config.ts --runInBand",
    "test:all": "npm run test && npm run test:e2e"
    ```

    Install jest dependencies if not already present:
    ```bash
    cd rms-api && npm install --save-dev jest ts-jest @types/jest @nestjs/testing supertest @types/supertest
    ```

    Step 2 — RED: Write all four test files with failing tests first.
    Run tests to confirm they fail:
    ```bash
    cd rms-api && npm run test -- --testPathPattern="branch-scope" 2>&1 | tail -10
    cd rms-api && npm run test:e2e -- --testPathPattern="merp-stub|audit.integration" 2>&1 | tail -10
    ```

    Step 3 — GREEN: The implementation is already complete (Plans 02 and 03 wrote the code).
    Run all tests — they should pass:
    ```bash
    cd rms-api && npm run test -- --testPathPattern="branch-scope" && npm run test:e2e -- --runInBand
    ```

    Step 4 — If any test fails, diagnose and fix the underlying implementation (not the test).
    Common failure modes:
    - auth.e2e.spec: TestController not wired into the testing module's AppModule — ensure it's added as a controller in the test's module setup
    - audit.integration.spec: PrismaService not connecting — ensure DATABASE_URL env var is set in test environment; check docker-compose is running
    - merp-stub.spec: MerpIntegrationLog.create failing — ensure migration was applied (run `npx prisma migrate deploy` before test run)

    For the auth e2e test, use @nestjs/jwt JwtService to sign test tokens:
    ```typescript
    import { JwtService } from '@nestjs/jwt';
    // In beforeAll:
    const jwtService = app.get(JwtService);
    const validToken = jwtService.sign({ sub: user.portalUserId, email: user.email });
    ```

    Test DB setup: The tests use the same DATABASE_URL as development (rms_dev).
    Before running integration/e2e tests, ensure Docker is running and migrations are applied:
    ```bash
    cd rms-api && docker compose up -d && npx prisma migrate deploy
    ```

    Clean up test data after each test using afterEach cleanup or transactions that roll back.
    For the e2e auth tests, use Prisma to seed and clean up test users directly.
  </implementation>
</feature>

<verification>
Run all tests and confirm:

```bash
cd rms-api && docker compose up -d
cd rms-api && npx prisma migrate deploy
cd rms-api && npm run test -- --testPathPattern="branch-scope"
cd rms-api && npm run test:e2e -- --runInBand
```

Expected output:
- branch-scope.spec.ts: 3 tests pass (Admin empty filter, single branch filter, multi-branch filter)
- auth.e2e.spec.ts: 5 tests pass (valid JWT, unprovisioned 403, invalid 401, Customer role 403, Agent role 200)
- audit.integration.spec.ts: 2 tests pass (logEvent writes row, rollback removes both writes)
- merp-stub.spec.ts: 4 tests pass (creditMemo result, creditMemo log row, replacementOrder result, replacementOrder log row)

Total: 14 tests, all passing.

Final check — trace to ROADMAP success criteria:
1. "Returns Agent authenticates via portal JWT" → auth.e2e Test 1 (FOUND-01)
2. "Customer cannot access Returns Agent endpoint → 403" → auth.e2e Test 4 (FOUND-02)
3. "Branch A user cannot retrieve Branch B RMA → 404" → branch-scope Tests 1-3 prove the filter exists; Phase 2 will test 404 behavior when RMA is built (FOUND-03)
4. "State change + audit in same transaction" → audit.integration Test 2 (FOUND-04)
5. "MERP adapter compiles with typed contracts; stub returns structured mock" → merp-stub Tests 1,3 (FOUND-05)
</verification>

<success_criteria>
- npm run test (unit) passes: branch-scope.spec.ts — 3/3 tests green
- npm run test:e2e passes: auth.e2e.spec.ts (5 tests), audit.integration.spec.ts (2 tests), merp-stub.spec.ts (4 tests) — 11/11 green
- Total: 14 tests passing, 0 failing
- No test uses mocks for PrismaService in integration/e2e tests — real DB is the arbiter
- branchScopeWhere returns {} for Admin — confirmed by test, not just by code review
- AuditEvent row exists in DB after logEvent inside $transaction — confirmed by DB query in test
- MerpIntegrationLog row exists in DB after stub call — confirmed by DB query in test
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-04-SUMMARY.md` with:
- Test counts (unit/e2e) and pass/fail results
- Mapping of each test to its ROADMAP success criterion
- Any flaky test behavior noted (e.g., auth e2e test requires Docker to be running)
- Known gap: FOUND-03 (Branch A cannot access Branch B RMA) is partially verified by branchScopeWhere unit tests — full 404 behavior test deferred to Phase 2 when the RMA model exists
- Confirmation that Phase 1 foundation is complete and Phase 2 can begin
</output>
