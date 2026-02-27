---
phase: 01-foundation
plan: 03
type: execute
wave: 2
depends_on:
  - "01-PLAN"
files_modified:
  - rms-api/src/audit/audit.module.ts
  - rms-api/src/audit/audit.service.ts
  - rms-api/src/audit/audit.types.ts
  - rms-api/src/merp/merp.module.ts
  - rms-api/src/merp/merp-adapter.interface.ts
  - rms-api/src/merp/merp-stub.adapter.ts
  - rms-api/src/merp/merp.types.ts
  - rms-api/src/app.module.ts
autonomous: true
requirements:
  - FOUND-04
  - FOUND-05

must_haves:
  truths:
    - "AuditService.logEvent() accepts a Prisma.TransactionClient parameter — it CANNOT be called outside a transaction"
    - "Calling MerpStubAdapter.createCreditMemo() returns a MerpResult with status 'STUB' — not a string, not undefined"
    - "Calling MerpStubAdapter.createReplacementOrder() returns a MerpResult with status 'STUB'"
    - "MerpStubAdapter logs the payload to MerpIntegrationLog in the database so calls are traceable"
    - "The MerpAdapter abstract class compiles with full TypeScript types for CreditMemoPayload, ReplacementOrderPayload, and MerpResult"
    - "AuditAction constants cover all expected RMA lifecycle events and are exported as a const object"
  artifacts:
    - path: "rms-api/src/audit/audit.types.ts"
      provides: "AuditAction const enum, AuditEventInput interface"
      exports: ["AuditAction", "AuditEventInput"]
    - path: "rms-api/src/audit/audit.service.ts"
      provides: "AuditService with logEvent(tx, input) — tx is Prisma.TransactionClient (enforces in-transaction writes)"
      exports: ["AuditService"]
    - path: "rms-api/src/merp/merp.types.ts"
      provides: "Typed contracts: CreditMemoPayload, ReplacementOrderPayload, MerpResult"
      exports: ["CreditMemoPayload", "ReplacementOrderPayload", "MerpResult"]
    - path: "rms-api/src/merp/merp-adapter.interface.ts"
      provides: "Abstract MerpAdapter class — v1 stub and future v2 live adapter both implement this"
      exports: ["MerpAdapter"]
    - path: "rms-api/src/merp/merp-stub.adapter.ts"
      provides: "MerpStubAdapter — v1 stub returning shaped MerpResult with status 'STUB'; logs to MerpIntegrationLog"
      exports: ["MerpStubAdapter"]
  key_links:
    - from: "rms-api/src/audit/audit.service.ts"
      to: "rms-api/prisma/schema.prisma (AuditEvent model)"
      via: "tx.auditEvent.create() — must be called inside $transaction()"
      pattern: "tx\\.auditEvent\\.create"
    - from: "rms-api/src/merp/merp-stub.adapter.ts"
      to: "rms-api/prisma/schema.prisma (MerpIntegrationLog model)"
      via: "prisma.merpIntegrationLog.create() to log every stub call"
      pattern: "merpIntegrationLog\\.create"
    - from: "rms-api/src/merp/merp.module.ts"
      to: "rms-api/src/merp/merp-adapter.interface.ts"
      via: "{ provide: MerpAdapter, useClass: MerpStubAdapter } DI token"
      pattern: "provide.*MerpAdapter"
---

<objective>
Implement the atomic audit log service and the typed MERP adapter interface with its v1 stub. These two subsystems are independent of each other and independent of Plan 02 (auth), so this plan runs in Wave 2 in parallel with Plan 02.

Purpose: The audit service establishes the atomicity pattern that every Phase 2+ service will use. The MERP adapter establishes the interface contract that the v2 live integration will implement — a correct stub now means zero breaking changes at v2 time.

Output: AuditService with a transaction-enforcing logEvent() signature; MerpAdapter abstract class with typed contracts; MerpStubAdapter that logs calls to MerpIntegrationLog.
</objective>

<execution_context>
@C:/Users/megan.delia/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/megan.delia/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/01-01-SUMMARY.md

<interfaces>
<!-- Key schema models this plan writes to -->

From rms-api/prisma/schema.prisma (generated Prisma types):
```typescript
// AuditEvent — append-only; written inside same $transaction() as state change
model AuditEvent {
  id         String   // @id @default(uuid())
  rmaId      String?  // nullable
  rmaLineId  String?  // nullable
  actorId    String   // FK → User
  actorRole  String
  action     String   // AuditAction constant value
  fromStatus String?
  toStatus   String?
  oldValue   Json?    // JSONB
  newValue   Json?    // JSONB
  metadata   Json?    // JSONB
  ipAddress  String?
  occurredAt DateTime @default(now())
}

// MerpIntegrationLog — one row per MERP adapter call (stub or live)
model MerpIntegrationLog {
  id              String
  rmaId           String
  operationType   String   // 'CREDIT_MEMO' | 'REPLACEMENT_ORDER'
  requestPayload  Json
  responsePayload Json?
  referenceId     String?
  status          String   // 'STUB' | 'SUCCESS' | 'FAILED'
  errorMessage    String?
  calledAt        DateTime @default(now())
}
```

From rms-api/src/prisma/prisma.service.ts:
```typescript
export class PrismaService extends PrismaClient
// Use this.prisma.$transaction(async (tx) => { ... }) for atomic writes
// tx is typed as Prisma.TransactionClient — pass to logEvent()
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement AuditService with atomic logEvent pattern</name>
  <files>
    rms-api/src/audit/audit.types.ts
    rms-api/src/audit/audit.service.ts
    rms-api/src/audit/audit.module.ts
  </files>
  <action>
    Implement the audit subsystem. The CRITICAL design constraint is that AuditService.logEvent() MUST accept a Prisma.TransactionClient parameter — this is the enforcement mechanism that prevents Pitfall 3 (audit committed outside transaction).

    ANTI-PATTERN TO AVOID: Do NOT write `async logEvent(input: AuditEventInput)` (no tx parameter). If logEvent doesn't accept tx, any caller can call it outside a transaction. The parameter is the design fence.

    Create rms-api/src/audit/audit.types.ts:
    ```typescript
    // AuditAction constants — stored as strings in DB for forward-compatibility.
    // Add new actions here as new lifecycle events are implemented in later phases.
    // Do NOT use a Prisma enum for this — strings allow expansion without migrations.
    export const AuditAction = {
      // RMA lifecycle
      RMA_CREATED: 'RMA_CREATED',
      RMA_SUBMITTED: 'RMA_SUBMITTED',
      RMA_APPROVED: 'RMA_APPROVED',
      RMA_REJECTED: 'RMA_REJECTED',
      RMA_INFO_REQUIRED: 'RMA_INFO_REQUIRED',
      RMA_CONTESTED: 'RMA_CONTESTED',
      RMA_CANCELLED: 'RMA_CANCELLED',
      RMA_RECEIVED: 'RMA_RECEIVED',
      RMA_RESOLVED: 'RMA_RESOLVED',
      RMA_CLOSED: 'RMA_CLOSED',
      STATUS_CHANGED: 'STATUS_CHANGED',

      // Line item operations
      LINE_ADDED: 'LINE_ADDED',
      LINE_UPDATED: 'LINE_UPDATED',
      LINE_SPLIT: 'LINE_SPLIT',
      DISPOSITION_SET: 'DISPOSITION_SET',

      // Communication and attachments
      COMMENT_ADDED: 'COMMENT_ADDED',
      ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',

      // MERP integration events
      MERP_CREDIT_TRIGGERED: 'MERP_CREDIT_TRIGGERED',
      MERP_REPLACEMENT_TRIGGERED: 'MERP_REPLACEMENT_TRIGGERED',

      // User provisioning (admin actions)
      USER_PROVISIONED: 'USER_PROVISIONED',
      ROLE_CHANGED: 'ROLE_CHANGED',
      ASSIGNMENT_CHANGED: 'ASSIGNMENT_CHANGED',
    } as const;

    export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

    // Input type for AuditService.logEvent() — all fields match AuditEvent model
    export interface AuditEventInput {
      rmaId?: string;
      rmaLineId?: string;
      actorId: string;
      actorRole: string;
      action: AuditAction;
      fromStatus?: string;
      toStatus?: string;
      oldValue?: Record<string, unknown>;
      newValue?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      ipAddress?: string;
    }
    ```

    Create rms-api/src/audit/audit.service.ts:
    ```typescript
    import { Injectable } from '@nestjs/common';
    import { Prisma } from '@prisma/client';
    import { AuditEventInput } from './audit.types';

    @Injectable()
    export class AuditService {
      // DESIGN CONSTRAINT: tx parameter is REQUIRED.
      // This signature enforces that logEvent() can only be called inside a
      // prisma.$transaction(async (tx) => { ... }) callback.
      // If tx is not available, the caller is not in a transaction — fix the caller.
      //
      // USAGE:
      //   return this.prisma.$transaction(async (tx) => {
      //     await tx.rma.update({ ... });                    // state change
      //     await this.auditService.logEvent(tx, { ... });  // audit (same tx)
      //   });
      async logEvent(tx: Prisma.TransactionClient, input: AuditEventInput): Promise<void> {
        await tx.auditEvent.create({
          data: {
            rmaId: input.rmaId,
            rmaLineId: input.rmaLineId,
            actorId: input.actorId,
            actorRole: input.actorRole,
            action: input.action,
            fromStatus: input.fromStatus,
            toStatus: input.toStatus,
            oldValue: input.oldValue as Prisma.InputJsonValue,
            newValue: input.newValue as Prisma.InputJsonValue,
            metadata: input.metadata as Prisma.InputJsonValue,
            ipAddress: input.ipAddress,
            // occurredAt is @default(now()) — never let caller supply it
          },
        });
      }
    }
    ```

    Create rms-api/src/audit/audit.module.ts:
    ```typescript
    import { Module } from '@nestjs/common';
    import { AuditService } from './audit.service';

    @Module({
      providers: [AuditService],
      exports: [AuditService],
    })
    export class AuditModule {}
    ```
  </action>
  <verify>
    <automated>cd rms-api && npm run build 2>&1 | grep "src/audit" | grep -c "error" | xargs -I{} test {} -eq 0 && echo "AUDIT_OK"</automated>
  </verify>
  <done>AuditService.logEvent() has signature logEvent(tx: Prisma.TransactionClient, input: AuditEventInput). AuditAction const object exported with all lifecycle event keys. TypeScript build passes for audit/ files.</done>
</task>

<task type="auto">
  <name>Task 2: Implement MERP adapter interface, types, stub, and wire into AppModule</name>
  <files>
    rms-api/src/merp/merp.types.ts
    rms-api/src/merp/merp-adapter.interface.ts
    rms-api/src/merp/merp-stub.adapter.ts
    rms-api/src/merp/merp.module.ts
    rms-api/src/app.module.ts
  </files>
  <action>
    Implement the MERP adapter subsystem. The interface-first pattern means v2 live adapter will be a drop-in replacement with zero service-layer changes.

    IMPORTANT: The MERP API contract (exact field names, nesting) is NOT yet confirmed with the MERP team — this is flagged as a known open question in RESEARCH.md. Use the standard electronics distribution domain model from RESEARCH.md as the v1 contract. The stub MUST return typed MerpResult objects (not strings) — Pitfall 4.

    Create rms-api/src/merp/merp.types.ts:
    ```typescript
    // WARNING: These payload shapes are based on standard electronics distribution
    // domain knowledge. They MUST be validated against the actual MERP API spec
    // before v2 live integration. The stub uses these shapes today; the live adapter
    // must match them exactly (or types must be updated before v2 work begins).

    export interface CreditMemoPayload {
      rmaId: string;           // RMS RMA ID — for idempotency checking
      rmaNumber: string;       // human-readable RMA number
      customerAccountNumber: string;
      lines: Array<{
        lineNumber: number;
        partNumber: string;
        quantityApproved: number;
        unitCost: number;      // in cents or as decimal — confirm with MERP team
        creditReason: string;
      }>;
      requestedBy: string;     // RMS user ID of the agent triggering the credit
    }

    export interface ReplacementOrderPayload {
      rmaId: string;
      rmaNumber: string;
      customerAccountNumber: string;
      shipToAddress: {
        line1: string;
        line2?: string;
        city: string;
        state: string;
        zip: string;
        country: string;
      };
      lines: Array<{
        lineNumber: number;
        partNumber: string;
        quantityApproved: number;
        unitCost: number;
      }>;
      requestedBy: string;
    }

    export interface MerpResult {
      success: boolean;
      referenceId: string | null;   // MERP-assigned ID (null on failure or stub)
      status: 'CREATED' | 'STUB' | 'FAILED';
      errorCode?: string;
      errorMessage?: string;
    }
    ```

    Create rms-api/src/merp/merp-adapter.interface.ts:
    ```typescript
    import { CreditMemoPayload, ReplacementOrderPayload, MerpResult } from './merp.types';

    // Abstract class (not interface) so NestJS DI can use it as an injection token.
    // Both MerpStubAdapter (v1) and MerpLiveAdapter (v2) extend this class.
    // Services inject MerpAdapter — never a concrete implementation directly.
    export abstract class MerpAdapter {
      abstract createCreditMemo(payload: CreditMemoPayload): Promise<MerpResult>;
      abstract createReplacementOrder(payload: ReplacementOrderPayload): Promise<MerpResult>;
    }
    ```

    Create rms-api/src/merp/merp-stub.adapter.ts:
    ```typescript
    import { Injectable, Logger } from '@nestjs/common';
    import { PrismaService } from '../prisma/prisma.service';
    import { MerpAdapter } from './merp-adapter.interface';
    import { CreditMemoPayload, ReplacementOrderPayload, MerpResult } from './merp.types';

    @Injectable()
    export class MerpStubAdapter extends MerpAdapter {
      private readonly logger = new Logger(MerpStubAdapter.name);

      constructor(private readonly prisma: PrismaService) {
        super();
      }

      async createCreditMemo(payload: CreditMemoPayload): Promise<MerpResult> {
        this.logger.log({ msg: 'MERP STUB: createCreditMemo', rmaId: payload.rmaId });

        const result: MerpResult = {
          success: true,
          referenceId: `STUB-CM-${Date.now()}`,
          status: 'STUB',
        };

        // Log every adapter call to MerpIntegrationLog for reconciliation
        await this.prisma.merpIntegrationLog.create({
          data: {
            rmaId: payload.rmaId,
            operationType: 'CREDIT_MEMO',
            requestPayload: payload as unknown as object,
            responsePayload: result as unknown as object,
            referenceId: result.referenceId,
            status: result.status,
          },
        });

        return result;
      }

      async createReplacementOrder(payload: ReplacementOrderPayload): Promise<MerpResult> {
        this.logger.log({ msg: 'MERP STUB: createReplacementOrder', rmaId: payload.rmaId });

        const result: MerpResult = {
          success: true,
          referenceId: `STUB-RO-${Date.now()}`,
          status: 'STUB',
        };

        await this.prisma.merpIntegrationLog.create({
          data: {
            rmaId: payload.rmaId,
            operationType: 'REPLACEMENT_ORDER',
            requestPayload: payload as unknown as object,
            responsePayload: result as unknown as object,
            referenceId: result.referenceId,
            status: result.status,
          },
        });

        return result;
      }
    }
    ```

    Create rms-api/src/merp/merp.module.ts:
    ```typescript
    import { Module } from '@nestjs/common';
    import { MerpAdapter } from './merp-adapter.interface';
    import { MerpStubAdapter } from './merp-stub.adapter';

    @Module({
      providers: [
        // Inject MerpAdapter token → resolves to MerpStubAdapter in v1.
        // To upgrade to live integration at v2: change useClass to MerpLiveAdapter.
        // Zero changes needed in any service that injects MerpAdapter.
        { provide: MerpAdapter, useClass: MerpStubAdapter },
      ],
      exports: [MerpAdapter],
    })
    export class MerpModule {}
    ```

    Update rms-api/src/app.module.ts to add AuditModule and MerpModule. This is the final AppModule state for Phase 1 — add both in the same edit to avoid conflicts with Plan 02's app.module.ts edit.

    NOTE: Plan 02 also updates app.module.ts. To avoid conflicts, the final app.module.ts for Phase 1 (after both plans complete) should include ALL of: ConfigModule, LoggerModule, PrismaModule, UsersModule, AuthModule, AuditModule, MerpModule, and APP_GUARD. Coordinate with Plan 02's app.module.ts update — this task writes the final merged version.

    Final rms-api/src/app.module.ts (complete Phase 1 state):
    ```typescript
    import { Module } from '@nestjs/common';
    import { APP_GUARD } from '@nestjs/core';
    import { ConfigModule } from '@nestjs/config';
    import { LoggerModule } from 'nestjs-pino';
    import { PrismaModule } from './prisma/prisma.module';
    import { AuthModule } from './auth/auth.module';
    import { UsersModule } from './users/users.module';
    import { AuditModule } from './audit/audit.module';
    import { MerpModule } from './merp/merp.module';
    import { JwtAuthGuard } from './auth/jwt-auth.guard';
    import { validate } from './config/config.schema';

    @Module({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        LoggerModule.forRoot({
          pinoHttp: {
            transport:
              process.env.NODE_ENV !== 'production'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        }),
        PrismaModule,
        UsersModule,
        AuthModule,
        AuditModule,
        MerpModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    })
    export class AppModule {}
    ```

    Verify TypeScript build passes for all Phase 1 modules:
    ```bash
    cd rms-api && npm run build 2>&1 | tail -10
    ```
  </action>
  <verify>
    <automated>cd rms-api && npm run build 2>&1 | grep -c "error TS" | xargs -I{} test {} -eq 0 && echo "MERP_OK"</automated>
  </verify>
  <done>MerpAdapter abstract class, MerpStubAdapter, and typed contracts compile without errors. MerpStubAdapter returns MerpResult with status 'STUB' (not a string). MerpIntegrationLog.create() is called on every stub invocation. DI token { provide: MerpAdapter, useClass: MerpStubAdapter } registered in MerpModule. Final AppModule includes all Phase 1 modules.</done>
</task>

</tasks>

<verification>
After both tasks complete:

1. TypeScript build: `cd rms-api && npm run build` — must exit 0, zero "error TS" lines
2. AuditService tx parameter check:
   ```bash
   grep -n "Prisma.TransactionClient" rms-api/src/audit/audit.service.ts
   ```
   Must show tx parameter in logEvent signature.
3. MerpResult return type check:
   ```bash
   grep -n "status: 'STUB'" rms-api/src/merp/merp-stub.adapter.ts
   ```
   Must find at least 2 matches (one per method).
4. MerpIntegrationLog write check:
   ```bash
   grep -n "merpIntegrationLog.create" rms-api/src/merp/merp-stub.adapter.ts
   ```
   Must find 2 matches (one per method).
5. DI token check:
   ```bash
   grep -n "provide.*MerpAdapter" rms-api/src/merp/merp.module.ts
   ```
   Must find the provide/useClass registration.
6. AuditAction completeness:
   ```bash
   grep -c ":" rms-api/src/audit/audit.types.ts
   ```
   Should have 20+ entries covering all lifecycle events.
</verification>

<success_criteria>
- AuditService.logEvent(tx, input) signature forces in-transaction usage — no tx-less overload exists
- AuditAction const object exported with all lifecycle event keys (RMA_CREATED through ROLE_CHANGED)
- CreditMemoPayload, ReplacementOrderPayload, MerpResult exported from merp.types.ts with complete typed fields
- MerpAdapter abstract class exported with two abstract methods
- MerpStubAdapter returns MerpResult typed objects (not strings) and logs every call to MerpIntegrationLog
- MerpModule registers { provide: MerpAdapter, useClass: MerpStubAdapter } — services inject MerpAdapter, not MerpStubAdapter
- Full TypeScript build passes across all Phase 1 modules (auth, audit, merp, users, config, prisma)
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-03-SUMMARY.md` with:
- Files created and their key exports
- Confirmation of TypeScript build passing
- Flag the open question: MERP API contract must be validated with MERP team before v2 live integration
- Confirmation that MerpIntegrationLog rows are created on stub calls
- Confirmation that AuditService.logEvent() requires Prisma.TransactionClient
</output>
