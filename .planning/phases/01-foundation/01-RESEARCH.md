# Phase 1: Foundation - Research

**Researched:** 2026-02-27
**Domain:** NestJS project scaffold, Prisma schema design, JWT validation, multi-branch RBAC data model, atomic audit log, MERP adapter interface
**Confidence:** HIGH (standard NestJS + Prisma + PostgreSQL patterns; verified against official Prisma docs and multiple authoritative sources)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Role Sourcing:** Roles are RMS-managed. The host portal provides user identity (who you are), but RMS stores its own role-to-user assignments in its own database table. The RMS does NOT read roles from the portal's JWT — it uses the portal's user ID as a foreign key to look up RMS role assignments.
- **Admin-only role management:** Only System Admin can assign, change, or revoke RMS role assignments.
- **Multi-branch user model:** A single user can be assigned to multiple branches with a role in each (e.g., a regional manager covering 3 branches). Schema must include a `user_branch_roles` or equivalent junction table from day one.
- **No default access:** Users who authenticate via the portal but have no RMS role assignment receive a 403 — no default access, no read-only fallback.
- **Query-layer ownership scoping:** Data-ownership scoping is enforced at the query layer (not just middleware). All RMA queries are automatically filtered by the user's assigned branch(es).
- **Admin global visibility:** Admin role has global visibility across all branches — no branch filter applied.
- **Finance and QC multi-branch model:** Finance and QC branch scoping follows the same multi-branch model (if Finance is assigned to 2 branches, they see RMAs from both).

### Claude's Discretion

- Auth handoff mechanism (cookie vs. Authorization header vs. postMessage) — confirm with portal team; Claude selects the technically appropriate pattern given traditional web app host.
- Audit log event granularity — Claude defines the initial event taxonomy; can be expanded in later phases.
- MERP adapter stub contract shapes — Claude defines the typed interfaces based on standard credit memo and replacement order data models for electronics distribution.
- Schema migration tooling and PostgreSQL configuration details.

### Deferred Ideas (OUT OF SCOPE)

- None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | User authenticates into the RMS via the host portal's JWT without a separate login | JWT validation via NestJS Passport guard extracting Bearer token from Authorization header; portal's user ID (sub claim) used as FK to look up RMS role assignments |
| FOUND-02 | System enforces role-based access for 6 internal roles and external Customer role | NestJS `RolesGuard` + `@Roles()` decorator pattern; roles stored in `user_branch_roles` table, not in JWT; RmsGuard resolves role from DB after JWT validation |
| FOUND-03 | System enforces data-ownership scoping — users can only access RMAs belonging to their branch or customer account | Prisma query-layer `WHERE branchId IN (user's branches)` filter; Admin bypasses filter; Customer filters by `customerId`; enforced in repository functions, not middleware |
| FOUND-04 | System writes an append-only audit log entry atomically with every state change and data modification | Prisma `$transaction()` interactive callback pattern writes state change + audit event in a single atomic DB transaction; audit table uses JSONB `old_value`/`new_value` columns |
| FOUND-05 | System exposes typed MERP adapter stubs for credit memo creation and replacement order creation with defined request/response contracts | TypeScript `MerpAdapter` interface with typed `CreditMemoPayload`, `ReplacementOrderPayload`, and `MerpResult`; `MerpStubAdapter` implements the interface returning shaped mock responses |
</phase_requirements>

---

## Summary

Phase 1 establishes the four infrastructure pillars that every subsequent phase depends on: project scaffold, database schema, authentication/RBAC, and the MERP adapter interface. None of these are features — they are the substrate that features are built on. The patterns required for this phase are among the most well-documented in the NestJS + Prisma + PostgreSQL ecosystem, which is why project-level research flagged this phase as not needing deep research. This document drills into the Phase 1-specific implementation details.

The most important architectural decision in this phase is the **multi-branch RBAC data model**: the portal provides user identity via JWT, but the RMS owns role assignments via a `user_branch_roles` junction table. This means NestJS guards must execute two steps — validate the portal's JWT, then query the RMS database for the user's role assignments in the relevant branch context. This is different from the common "roles in JWT" pattern and requires careful guard composition. All Prisma queries that filter by branch must accept an array of branch IDs (not a single branch ID) to support the multi-branch case.

The second critical decision is **atomic audit logging**: every state change and field modification must write an audit event in the same Prisma `$transaction()` interactive callback. If the audit write fails, the state change rolls back. If the state change fails, no audit event is written. This is straightforward with Prisma's interactive transaction API — the service receives a `tx` (transaction client) and passes it through to both the repository write and the audit write.

**Primary recommendation:** Scaffold NestJS with the Prisma + PostgreSQL foundation first (schema + migrations), wire the two-step auth guard (JWT validate → DB role lookup) second, add the MERP adapter interface third — this order respects the dependency chain and ensures every subsequent phase has a working auth context to test against.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@nestjs/core` | 11.x | API framework | Structured guards, DI container, modular architecture |
| `@nestjs/jwt` | latest (compatible with NestJS 11) | JWT signing and verification | Official NestJS JWT integration |
| `@nestjs/passport` | latest | Passport strategy wiring into NestJS guard system | Official NestJS Passport integration |
| `passport-jwt` | 4.x | JWT extraction and verification strategy | Standard Passport strategy for Bearer tokens |
| `prisma` | 7.x (7.4.2 current) | ORM and migration tooling | Type-safe client, declarative schema, `$transaction()` for atomic writes |
| `@prisma/client` | 7.x | Generated type-safe database client | Auto-generated from schema; Rust-free in v7 (Alpine Docker compatible) |
| `postgresql` | 16 | Primary database | JSONB for audit payloads, ACID transactions, RLS capability |
| `zod` | 3.x | Config and input validation | Shared schemas between FE and BE; used to validate env config at startup |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@nestjs/config` | latest | Environment variable management | Load `.env` at startup; validate with Zod |
| `pino` + `pino-http` | latest | Structured HTTP and application logging | Structured JSON logs; faster than Winston |
| `nestjs-cls` | latest | AsyncLocalStorage request context | Carry transaction context through service call chain without prop-drilling `tx` parameter |
| `redis` (ioredis) | 7.x | (Install now; activate in v2) | BullMQ backing store for async MERP calls in v2 |
| `bullmq` | 5.70.x | (Install now; activate in v2) | Background jobs for async MERP calls and notifications in v2 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Prisma 7 | TypeORM | TypeORM has unresolved maintenance gaps; not acceptable for financial-adjacent system |
| Prisma 7 | Drizzle ORM | Drizzle is better for serverless/edge; this is a traditional Node.js server; Prisma's migration story is more mature for complex schemas |
| Two-step JWT→DB guard | Roles in portal JWT | Portal does not manage RMS roles; roles must be in RMS DB to allow Admin to provision without portal changes |
| `user_branch_roles` junction | Single `role` column on `users` | Single column cannot represent a user assigned to multiple branches with different roles per branch |

**Installation:**
```bash
# Backend scaffold
npm install -g @nestjs/cli
nest new rms-api

# Auth
npm install @nestjs/jwt @nestjs/passport passport passport-jwt
npm install @types/passport-jwt --save-dev

# ORM
npm install prisma @prisma/client
npx prisma init

# Config and logging
npm install @nestjs/config zod pino pino-http

# Context propagation (for clean tx passing)
npm install nestjs-cls

# Install now, activate in v2
npm install bullmq ioredis
```

---

## Architecture Patterns

### Recommended Project Structure

```
rms-api/
├── src/
│   ├── app.module.ts               # Root module
│   ├── main.ts                     # Bootstrap; Pino logger; global ValidationPipe
│   ├── prisma/
│   │   ├── prisma.module.ts        # PrismaModule (global)
│   │   ├── prisma.service.ts       # PrismaService extends PrismaClient
│   │   └── prisma-cls.plugin.ts   # nestjs-cls transaction plugin (optional)
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── jwt.strategy.ts         # PassportStrategy(Strategy, 'jwt')
│   │   ├── jwt-auth.guard.ts       # AuthGuard('jwt') — validates portal JWT
│   │   ├── rms-auth.guard.ts       # Looks up user in user_branch_roles after JWT
│   │   ├── roles.guard.ts          # Checks required role from @Roles() metadata
│   │   └── roles.decorator.ts     # @Roles(...roles)
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.service.ts        # findByPortalId(); findBranchRoles()
│   │   └── users.repository.ts
│   ├── merp/
│   │   ├── merp.module.ts
│   │   ├── merp-adapter.interface.ts   # MerpAdapter interface
│   │   ├── merp-stub.adapter.ts        # v1 stub implementation
│   │   └── merp.types.ts              # CreditMemoPayload, ReplacementOrderPayload, MerpResult
│   ├── audit/
│   │   ├── audit.module.ts
│   │   ├── audit.service.ts        # logEvent(tx, event): writes to audit_events in-transaction
│   │   └── audit.types.ts          # AuditAction enum, AuditEventInput
│   └── config/
│       └── config.schema.ts        # Zod schema for env validation
├── prisma/
│   ├── schema.prisma
│   └── migrations/                 # Numbered migration files
└── docker-compose.yml
```

### Pattern 1: Two-Step Auth Guard (JWT Validate + RMS Role Lookup)

**What:** NestJS request pipeline runs two guards in sequence. The first (`JwtAuthGuard`) validates the portal's JWT and attaches the portal user ID to `req.user`. The second (`RmsAuthGuard`) looks up that portal user ID in the `user_branch_roles` table and attaches the user's RMS role and branch assignments. If no RMS record exists, returns 403.

**When to use:** Every endpoint in the RMS. Apply `JwtAuthGuard` globally via `APP_GUARD`; apply `RolesGuard` per-controller or per-route.

**Why two steps, not one:** The portal JWT contains identity (`sub` = portal user ID) but NOT RMS roles. RMS roles live in the database and can change (Admin can provision at any time). Baking roles into the JWT would require token rotation on every role change — unacceptable for an embedded portal context.

```typescript
// Source: NestJS official docs (https://docs.nestjs.com/security/authentication)
// src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('PORTAL_JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; email: string }) {
    // Only validates token signature and expiry.
    // RMS role lookup happens in RmsAuthGuard.
    return { portalUserId: payload.sub, email: payload.email };
  }
}
```

```typescript
// src/auth/rms-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UsersService } from '../users/users.service';

@Injectable()
export class RmsAuthGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { portalUserId } = request.user; // set by JwtAuthGuard

    const rmsUser = await this.usersService.findByPortalId(portalUserId);
    if (!rmsUser) {
      throw new ForbiddenException('User not provisioned in RMS');
    }

    // Attach full RMS user context (id, role, branchIds[]) to request
    request.rmsUser = rmsUser;
    return true;
  }
}
```

```typescript
// src/auth/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true; // no @Roles() = any authenticated user

    const { rmsUser } = context.switchToHttp().getRequest();
    return requiredRoles.includes(rmsUser.role);
  }
}
```

```typescript
// src/auth/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

### Pattern 2: Multi-Branch RBAC Prisma Schema

**What:** A `user_branch_roles` junction table records (userId, branchId, role) tuples. One user can appear multiple times — once per branch they are assigned to. Queries filter by `branchId IN (user's branch IDs)` using the array from the junction table. Admin users bypass the branch filter (they have global visibility).

**When to use:** Every repository function that returns RMA records must accept the caller's `branchIds: string[]` and apply the filter. Use a repository helper `branchScopeWhere()` that returns `{}` for Admin and `{ branchId: { in: branchIds } }` for all other roles.

```prisma
// prisma/schema.prisma (Phase 1 relevant models)

model User {
  id           String            @id @default(uuid())
  portalUserId String            @unique  // FK from host portal JWT sub claim
  email        String            @unique
  displayName  String
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
  branchRoles  UserBranchRole[]
  auditEvents  AuditEvent[]
}

model Branch {
  id          String            @id @default(uuid())
  name        String
  code        String            @unique
  branchRoles UserBranchRole[]
}

// Junction table: one row per (user, branch, role) assignment
model UserBranchRole {
  id        String   @id @default(uuid())
  userId    String
  branchId  String
  role      RmsRole
  assignedAt DateTime @default(now())
  assignedBy String   // FK → User (Admin who granted this)

  user   User   @relation(fields: [userId], references: [id])
  branch Branch @relation(fields: [branchId], references: [id])

  @@unique([userId, branchId]) // one role per user per branch
}

enum RmsRole {
  RETURNS_AGENT
  BRANCH_MANAGER
  WAREHOUSE
  QC
  FINANCE
  ADMIN
  CUSTOMER
}

model AuditEvent {
  id          String    @id @default(uuid())
  rmaId       String?   // indexed; nullable (non-RMA events possible)
  rmaLineId   String?   // nullable: line-level actions
  actorId     String    // FK → User
  actorRole   String    // snapshot of role at event time
  action      String    // AuditAction enum value stored as string
  fromStatus  String?   // RMAStatus value for state transitions
  toStatus    String?
  oldValue    Json?     // JSONB: field-level before state
  newValue    Json?     // JSONB: field-level after state
  metadata    Json?     // flexible extra context
  ipAddress   String?
  occurredAt  DateTime  @default(now())

  actor User @relation(fields: [actorId], references: [id])

  @@index([rmaId])
  @@index([actorId])
  @@index([occurredAt])
}
```

```typescript
// src/users/users.service.ts — branch scope helper
export interface RmsUserContext {
  id: string;
  portalUserId: string;
  email: string;
  role: RmsRole;           // "primary" role (most permissive across branches)
  branchIds: string[];     // all branches this user is assigned to
  isAdmin: boolean;
}

async findByPortalId(portalUserId: string): Promise<RmsUserContext | null> {
  const user = await this.prisma.user.findUnique({
    where: { portalUserId },
    include: { branchRoles: true },
  });
  if (!user || user.branchRoles.length === 0) return null;

  // Determine primary role (Admin > Manager > Agent > etc.)
  const roles = user.branchRoles.map((br) => br.role);
  const primaryRole = resolvePrimaryRole(roles);

  return {
    id: user.id,
    portalUserId: user.portalUserId,
    email: user.email,
    role: primaryRole,
    branchIds: user.branchRoles.map((br) => br.branchId),
    isAdmin: primaryRole === RmsRole.ADMIN,
  };
}
```

```typescript
// Repository query-layer ownership filter
// src/rma/rma.repository.ts
function branchScopeWhere(user: RmsUserContext) {
  if (user.isAdmin) return {}; // Admin: no filter
  return { branchId: { in: user.branchIds } };
}

async findAll(user: RmsUserContext) {
  return this.prisma.rma.findMany({
    where: {
      ...branchScopeWhere(user),
    },
  });
}

async findById(rmaId: string, user: RmsUserContext) {
  const rma = await this.prisma.rma.findFirst({
    where: {
      id: rmaId,
      ...branchScopeWhere(user),
    },
  });
  // Returns null (→ 404) if not in user's branches — does NOT leak existence
  return rma;
}
```

### Pattern 3: Atomic Audit Log with Prisma Interactive Transaction

**What:** State changes and audit event writes are wrapped in a single `prisma.$transaction()` interactive callback. The service receives a `tx` parameter (or uses the ambient `PrismaClient`) and passes it to both the repository write and the audit service write. Either both succeed or both roll back.

**When to use:** Every function that modifies RMA status or significant fields. The audit service is a simple `logEvent(tx, input)` function — it does not need to know about the state machine.

```typescript
// Source: Prisma official docs (https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
// src/audit/audit.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface AuditEventInput {
  rmaId?: string;
  rmaLineId?: string;
  actorId: string;
  actorRole: string;
  action: string;           // AuditAction enum value
  fromStatus?: string;
  toStatus?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  async logEvent(
    tx: Prisma.TransactionClient,
    input: AuditEventInput,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        ...input,
        occurredAt: new Date(), // server-set, never client-supplied
      },
    });
  }
}
```

```typescript
// src/rma/rma.service.ts — atomic state change + audit
async updateRmaStatus(
  rmaId: string,
  newStatus: string,
  actor: RmsUserContext,
  ipAddress: string,
): Promise<Rma> {
  return this.prisma.$transaction(async (tx) => {
    // 1. Fetch current state
    const rma = await tx.rma.findFirst({
      where: { id: rmaId, ...branchScopeWhere(actor) },
    });
    if (!rma) throw new NotFoundException();

    // 2. Update RMA status
    const updated = await tx.rma.update({
      where: { id: rmaId },
      data: { status: newStatus, updatedAt: new Date() },
    });

    // 3. Write audit event IN THE SAME TRANSACTION
    await this.auditService.logEvent(tx, {
      rmaId,
      actorId: actor.id,
      actorRole: actor.role,
      action: 'STATUS_CHANGED',
      fromStatus: rma.status,
      toStatus: newStatus,
      ipAddress,
    });

    return updated;
    // If either write fails, both roll back — atomicity guaranteed
  });
}
```

### Pattern 4: MERP Adapter Interface

**What:** A TypeScript interface defines the MERP contract. The v1 `MerpStubAdapter` implements it and returns shaped mock responses. The v2 `MerpLiveAdapter` will implement the same interface with real HTTP calls. No service-layer changes needed at v2 time.

**When to use:** Any service that needs to trigger a MERP credit memo or replacement order calls the injected `MerpAdapter` — never makes HTTP calls directly.

```typescript
// src/merp/merp.types.ts
export interface CreditMemoPayload {
  rmaId: string;
  rmaNumber: string;
  customerAccountNumber: string;
  lines: Array<{
    lineNumber: number;
    partNumber: string;
    quantityApproved: number;
    unitCost: number;
    creditReason: string;
  }>;
  requestedBy: string; // RMS user ID
}

export interface ReplacementOrderPayload {
  rmaId: string;
  rmaNumber: string;
  customerAccountNumber: string;
  shipToAddress: {
    line1: string;
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
  referenceId: string | null; // MERP-assigned ID (null on failure)
  status: 'CREATED' | 'STUB' | 'FAILED';
  errorCode?: string;
  errorMessage?: string;
}
```

```typescript
// src/merp/merp-adapter.interface.ts
import { CreditMemoPayload, ReplacementOrderPayload, MerpResult } from './merp.types';

export abstract class MerpAdapter {
  abstract createCreditMemo(payload: CreditMemoPayload): Promise<MerpResult>;
  abstract createReplacementOrder(payload: ReplacementOrderPayload): Promise<MerpResult>;
}
```

```typescript
// src/merp/merp-stub.adapter.ts — v1 implementation
import { Injectable, Logger } from '@nestjs/common';
import { MerpAdapter } from './merp-adapter.interface';
import { CreditMemoPayload, ReplacementOrderPayload, MerpResult } from './merp.types';

@Injectable()
export class MerpStubAdapter extends MerpAdapter {
  private readonly logger = new Logger(MerpStubAdapter.name);

  async createCreditMemo(payload: CreditMemoPayload): Promise<MerpResult> {
    this.logger.log({ msg: 'MERP STUB: createCreditMemo', rmaId: payload.rmaId });
    // Log the full payload to merp_integration_log (see MERP logging section)
    return {
      success: true,
      referenceId: `STUB-CM-${Date.now()}`,
      status: 'STUB',
    };
  }

  async createReplacementOrder(payload: ReplacementOrderPayload): Promise<MerpResult> {
    this.logger.log({ msg: 'MERP STUB: createReplacementOrder', rmaId: payload.rmaId });
    return {
      success: true,
      referenceId: `STUB-RO-${Date.now()}`,
      status: 'STUB',
    };
  }
}
```

### Pattern 5: Docker Compose Local Dev Environment

**What:** Docker Compose runs PostgreSQL 16 and Redis 7. NestJS and Prisma run outside Docker (on the host) for fast HMR during development. Health check ensures Postgres is ready before migrations run.

```yaml
# docker-compose.yml
# Source: Prisma official Docker guide (https://www.prisma.io/docs/guides/docker)
# and Prisma 7 + NestJS guide (https://dev.to/robson_idongesitsamuel_b/...)
services:
  postgres:
    image: postgres:16
    container_name: rms_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: rms_dev
      POSTGRES_USER: rms
      POSTGRES_PASSWORD: rms_local_dev
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rms -d rms_dev"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: rms_redis
    restart: unless-stopped
    ports:
      - '6379:6379'

volumes:
  postgres_data:
```

```
# .env (local dev)
DATABASE_URL="postgresql://rms:rms_local_dev@localhost:5432/rms_dev?schema=public"
PORTAL_JWT_SECRET="ask-the-portal-team-for-this-value"
NODE_ENV=development
```

### Anti-Patterns to Avoid

- **Roles in JWT claims:** The portal JWT must not contain RMS roles. Roles change when Admin provisions a user; the JWT would be stale. Always look up roles from the `user_branch_roles` table.
- **Single `branchId` on User model:** Users span multiple branches. A single FK column on the `users` table cannot represent this. Use the `user_branch_roles` junction table from day one.
- **Audit write in a separate transaction:** If the audit `logEvent()` call is made after the state change commits (outside the transaction), they can diverge. Always pass the `tx` instance through.
- **Direct `prisma.rma.update({ data: { status: ... } })` in service layer:** The state machine (Phase 2) must own all status writes. Phase 1 lays the plumbing (the `AuditService` + `$transaction` pattern); Phase 2 adds the state machine on top. Do not shortcut by writing status directly in Phase 1 tests — use a `updateRmaStatus()` service function that will later delegate to the state machine.
- **MERP stub returning unstructured strings:** The stub must return a `MerpResult` typed object matching the interface. A stub that returns `"ok"` will require consuming code to be rewritten at v2 integration time.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT validation | Custom token parsing and signature verification | `passport-jwt` + `@nestjs/passport` | Edge cases in JWT validation (expiry, alg confusion, issuer check); library handles all of them correctly |
| Database transactions | Manual `BEGIN/COMMIT/ROLLBACK` SQL | Prisma `$transaction()` interactive callback | Prisma handles isolation level, timeout, connection pool management; manual transactions miss error cases |
| Env variable validation | `if (!process.env.X) throw` in each file | Zod schema validation at startup via `@nestjs/config` + custom `validate` function | Fail fast at startup with a clear message listing all missing vars; not scattered across files |
| Request context propagation | Pass `userId` and `tx` through every function signature | `nestjs-cls` AsyncLocalStorage plugin | Prevents prop-drilling of `tx` through 5 layers of service/repo calls; clean service signatures |
| RLS enforcement | PostgreSQL row-level security policies | Application-layer `branchScopeWhere()` filter in every repository function | Application-layer enforcement is testable in unit tests; PostgreSQL RLS is invisible to the ORM and harder to verify |

**Key insight:** For this phase, the hardest part is not the technology — it is correctly modeling the multi-branch user relationship in the schema and ensuring that model propagates through every repository function. The application-layer filter approach (`branchScopeWhere()`) is more maintainable than PostgreSQL RLS because it is visible in the code and unit-testable.

---

## Common Pitfalls

### Pitfall 1: New Portal User Gets 500 Instead of 403

**What goes wrong:** A user logs into the portal for the first time. Their JWT validates successfully. The `RmsAuthGuard` queries `user_branch_roles` and finds zero rows. If the guard does not handle the null case, it crashes with a NullReferenceError instead of returning 403.

**Why it happens:** The guard is written assuming all portal users have been provisioned. The null check is missing.

**How to avoid:** `RmsAuthGuard.canActivate()` must explicitly check for null return from `usersService.findByPortalId()` and throw `ForbiddenException('User not provisioned in RMS')`. Write a test: create a valid portal JWT for a user with no `user_branch_roles` rows; assert the API returns 403.

**Warning signs:** No test for "valid JWT but no RMS role" scenario.

### Pitfall 2: `branchScopeWhere()` Not Applied in findById

**What goes wrong:** `findAll()` correctly filters by branch, but `findById()` was written as `prisma.rma.findUnique({ where: { id } })` without the branch filter. A user at Branch A can read any RMA by ID if they know or guess the UUID.

**Why it happens:** The list query is obviously scoped; the detail query feels redundant to scope.

**How to avoid:** Use `findFirst` (not `findUnique`) with both `id` and `branchScopeWhere(user)` in the WHERE clause. `findFirst` returns null (→ 404) if the RMA exists but is not in the user's branch — this does not leak existence. Write a test: create an RMA in Branch B, log in as a Branch A user, assert GET `/rmas/:id` returns 404.

**Warning signs:** Any `findUnique({ where: { id } })` call without an ownership filter in the repository.

### Pitfall 3: Audit Event Committed Separately from State Change

**What goes wrong:** Developer writes: `await rmaRepo.updateStatus(...)`, then `await auditService.logEvent(...)`. If the process crashes between the two calls (e.g., OOM kill, network timeout), the status changed but no audit event exists — or vice versa if the order is reversed.

**Why it happens:** Forgetting to pass the `tx` instance or forgetting to wrap both calls in `$transaction()`.

**How to avoid:** The service function signature must enforce: `$transaction(async (tx) => { await repo.update(tx, ...); await audit.logEvent(tx, ...); })`. If `auditService.logEvent` does not accept a `tx` parameter, it cannot be called in-transaction — this is a design enforcement mechanism.

**Warning signs:** `auditService.logEvent()` does not accept a `Prisma.TransactionClient` parameter.

### Pitfall 4: MERP Stub Contract Not Agreed Before Writing the Stub

**What goes wrong:** The stub is written with plausible-looking field names. When the MERP team provides their actual API spec, the field names, nesting, and types differ. All code consuming the stub result must be rewritten.

**Why it happens:** The stub was written to unblock development, not to match a contract.

**How to avoid:** Before writing the stub, meet with the MERP team and agree on: request payload shape, response shape, error code enum, idempotency behavior (does calling the same RMA twice create two credit memos?). The `MerpResult` type must reflect the agreed contract, not a guess. Flag this as a known blocker in the phase plan.

**Warning signs:** The `CreditMemoPayload` and `MerpResult` types have fields like `data`, `result`, or `response` that are not tied to a real MERP API spec.

### Pitfall 5: Prisma 7 Node.js Version Mismatch

**What goes wrong:** Prisma 7 requires Node.js 20.19.0+ (the Rust-free engine removed the need for binary compatibility but set a minimum Node.js version). Running on Node.js 18.x fails on startup.

**Why it happens:** Node.js 18 LTS is still in common use; many developer machines have it installed.

**How to avoid:** Pin Node.js version in `.nvmrc` or `package.json engines` field: `"engines": { "node": ">=20.19.0" }`. Docker image should use `node:20-alpine`. Verify with `node --version` before first `npx prisma generate`.

**Warning signs:** `Error: Prisma Client requires Node.js >= 20.19.0` at startup.

---

## Code Examples

### Prisma Schema — Full Phase 1 Core Tables

```prisma
// Source: Prisma official docs (https://www.prisma.io/docs/orm/prisma-migrate)
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Identity & RBAC ──────────────────────────────────────────────────────────

model User {
  id           String   @id @default(uuid())
  portalUserId String   @unique  // portal JWT sub claim
  email        String   @unique
  displayName  String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  branchRoles UserBranchRole[]
  auditEvents AuditEvent[]
}

model Branch {
  id          String   @id @default(uuid())
  name        String
  code        String   @unique
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  branchRoles UserBranchRole[]
}

model UserBranchRole {
  id          String   @id @default(uuid())
  userId      String
  branchId    String
  role        RmsRole
  assignedAt  DateTime @default(now())
  assignedBy  String   // portal user ID of Admin who granted

  user   User   @relation(fields: [userId], references: [id])
  branch Branch @relation(fields: [branchId], references: [id])

  @@unique([userId, branchId])  // one role per (user, branch) pair
  @@index([userId])
  @@index([branchId])
}

enum RmsRole {
  RETURNS_AGENT
  BRANCH_MANAGER
  WAREHOUSE
  QC
  FINANCE
  ADMIN
  CUSTOMER
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

model AuditEvent {
  id         String   @id @default(uuid())
  rmaId      String?
  rmaLineId  String?
  actorId    String
  actorRole  String
  action     String   // AuditAction enum value (stored as string for flexibility)
  fromStatus String?
  toStatus   String?
  oldValue   Json?    // JSONB
  newValue   Json?    // JSONB
  metadata   Json?    // JSONB — flexible bag
  ipAddress  String?
  occurredAt DateTime @default(now())

  actor User @relation(fields: [actorId], references: [id])

  @@index([rmaId])
  @@index([actorId])
  @@index([occurredAt])
  // Future: add PARTITION BY RANGE (occurred_at) in raw SQL migration
}

// ─── MERP Integration Log ─────────────────────────────────────────────────────

model MerpIntegrationLog {
  id             String   @id @default(uuid())
  rmaId          String
  operationType  String   // 'CREDIT_MEMO' | 'REPLACEMENT_ORDER'
  requestPayload Json     // full payload sent to MERP (or would-be sent in stub)
  responsePayload Json?   // full MERP response
  referenceId    String?  // MERP-returned reference ID
  status         String   // 'STUB' | 'SUCCESS' | 'FAILED'
  errorMessage   String?
  calledAt       DateTime @default(now())

  @@index([rmaId])
}

// Note: RMA, RmaLine, Comment, Attachment models added in Phase 2.
// This Phase 1 migration establishes only the cross-cutting infrastructure tables.
```

### AuditAction Enum (TypeScript constant — not a Prisma enum)

```typescript
// src/audit/audit.types.ts
// Stored as string in DB for forward-compatibility; validated at write time

export const AuditAction = {
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
  LINE_ADDED: 'LINE_ADDED',
  LINE_UPDATED: 'LINE_UPDATED',
  LINE_SPLIT: 'LINE_SPLIT',
  DISPOSITION_SET: 'DISPOSITION_SET',
  COMMENT_ADDED: 'COMMENT_ADDED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  MERP_CREDIT_TRIGGERED: 'MERP_CREDIT_TRIGGERED',
  MERP_REPLACEMENT_TRIGGERED: 'MERP_REPLACEMENT_TRIGGERED',
  ASSIGNMENT_CHANGED: 'ASSIGNMENT_CHANGED',
  USER_PROVISIONED: 'USER_PROVISIONED',
  ROLE_CHANGED: 'ROLE_CHANGED',
} as const;

export type AuditAction = typeof AuditAction[keyof typeof AuditAction];
```

### NestJS Module Wiring

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
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
    PrismaModule,
    PassportModule,
    AuthModule,
    UsersModule,
    AuditModule,
    MerpModule,
  ],
  providers: [
    // Apply JWT guard globally — every route is authenticated by default
    // Use @Public() decorator to opt out on health check routes
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@prisma/client` with Rust binary engine | Rust-free TypeScript engine in Prisma 7 | Prisma 7.0 (2025) | Alpine Docker images work without OpenSSL workarounds; Node.js 20.19.0+ required |
| NestJS + Express by default | NestJS + Fastify adapter for production headroom | NestJS 10+ | ~2x throughput for same compute; optional but easy to swap |
| Store roles in JWT | DB-authoritative role lookup per request | Industry best practice shift | Roles can be changed without token rotation; required when Auth is separated from role management |
| Prisma `$transaction([...])` batch API | `$transaction(async (tx) => { ... })` interactive callback | Prisma 2.29+ | Interactive transactions allow conditional logic between operations; required for audit-in-same-transaction pattern |

**Deprecated/outdated:**
- `@nestjs/typeorm`: TypeORM has unresolved critical bugs as of early 2026. Do not use.
- Prisma `$transaction([op1, op2])` sequential batch (non-interactive): Cannot do audit-in-same-transaction because no conditional logic is possible between operations. Use interactive form.
- NestJS + Express default for production: Use Fastify adapter (`@nestjs/platform-fastify`) unless team is unfamiliar with it.

---

## Open Questions

1. **MERP API contract for credit memo and replacement order**
   - What we know: MERP is a custom ERP. Standard credit memo fields include customer account, part number, quantity, unit cost, reason code.
   - What's unclear: Exact field names, nesting depth, idempotency behavior (does MERP accept the same RMA ID twice without creating a duplicate?), error code enum, authentication mechanism (basic auth? API key? OAuth?).
   - Recommendation: Schedule a meeting with the MERP team before finalizing `merp.types.ts`. The stub must match the actual contract — a guess will require rewriting consuming code at v2. Flag as a Phase 1 blocker if MERP team is unavailable.

2. **Portal JWT secret and token format**
   - What we know: The portal provides a JWT with at minimum a `sub` claim (user ID). NestJS validates the signature.
   - What's unclear: JWT secret vs. RS256 public key? Does the portal JWT contain any additional claims (email, display name) that eliminate the need for a separate portal user lookup? What is the token expiry?
   - Recommendation: Obtain the JWT secret (or public key for RS256) and a sample decoded token from the portal team in Sprint 0. Configure `JwtStrategy` accordingly.

3. **Portal auth handoff mechanism (Auth injection pattern)**
   - What we know: The host portal is a traditional web app. Three patterns are viable: (a) Authorization header with Bearer token (most portable), (b) HTTP-only cookie on shared subdomain (cleanest security), (c) postMessage token handoff (for cross-origin embedding).
   - What's unclear: Is the RMS served from the same domain as the portal? Is the portal a server-rendered app or SPA?
   - Recommendation: Default to Authorization header pattern (Bearer token from React context) — it works cross-origin and avoids third-party cookie deprecation. Confirm with portal team whether shared-domain cookie is viable for a simpler integration.

---

## Sources

### Primary (HIGH confidence)
- [Prisma official docs — Transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions) — Interactive `$transaction()` callback pattern; verified atomic write behavior
- [Prisma official docs — Docker](https://www.prisma.io/docs/guides/docker) — Prisma 7 + Docker Compose setup; Rust-free engine note
- [NestJS official docs — Guards](https://docs.nestjs.com/guards) — `CanActivate` interface, `Reflector`, guard execution order
- [NestJS official docs — Authentication](https://docs.nestjs.com/security/authentication) — JWT Passport strategy, `ExtractJwt.fromAuthHeaderAsBearerToken()`, guard composition
- [Prisma official docs — Migrate](https://www.prisma.io/docs/orm/prisma-migrate) — Migration workflow, schema declarations

### Secondary (MEDIUM confidence)
- [DEV Community — Complete Guide to Prisma 7 with Docker and Docker Compose in NestJS](https://dev.to/robson_idongesitsamuel_b/a-complete-guide-to-using-prisma-7-with-docker-and-docker-compose-in-nestjs-80i) — Prisma 7 Node.js 20.19.0+ minimum requirement; Rust-free engine impact
- [Yarsa DevBlog — Audit Trail in PostgreSQL using Prisma](https://blog.yarsalabs.com/audit-trail-in-postgresql-using-prisma/) — JSONB audit table pattern with `old_data`/`new_data` columns; Prisma `create` for audit entries
- [How to Implement RBAC with Custom Guards in NestJS — OneUptime, Jan 2026](https://oneuptime.com/blog/post/2026-01-25-rbac-custom-guards-nestjs/view) — `RolesGuard`, `@Roles()` decorator, `Reflector`, guard composition pattern
- [Row-Level Security in PostgreSQL — OneUptime, Jan 2026](https://oneuptime.com/blog/post/2026-01-25-row-level-security-postgresql/view) — RLS pattern discussion; confirms application-layer filtering as simpler alternative
- [wanago.io — NestJS + Prisma Transactions](https://wanago.io/2023/04/17/api-nestjs-prisma-transactions/) — Interactive transaction pattern with repository layer
- [Securing Multi-Tenant Applications Using PostgreSQL RLS with Prisma — Medium](https://medium.com/@francolabuschagne90/securing-multi-tenant-applications-using-row-level-security-in-postgresql-with-prisma-orm-4237f4d4bd35) — Prisma Client Extensions for RLS; confirms complexity vs. application-layer approach

### Tertiary (LOW confidence — informational only)
- Project-level research files (`STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md`) — internal documents synthesized from multiple sources; HIGH confidence within this project's context

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Versions verified via npm and official docs; all core libraries are NestJS 11 + Prisma 7 as decided in project research
- Architecture: HIGH — NestJS guard composition, Prisma `$transaction()`, and multi-branch junction table are well-documented standard patterns with multiple verified sources
- Pitfalls: MEDIUM-HIGH — Most pitfalls are domain-specific extrapolations of general Prisma/NestJS patterns; the multi-branch RBAC guard pitfall is specific to this project's unusual auth model (portal identity + RMS roles)
- MERP contract: LOW — The `CreditMemoPayload` and `ReplacementOrderPayload` type shapes are based on standard electronics distribution domain knowledge, not a confirmed MERP spec. Must be validated with MERP team before stub is finalized.

**Research date:** 2026-02-27
**Valid until:** 2026-03-29 (30 days — stable patterns; only MERP contract section may change faster)
