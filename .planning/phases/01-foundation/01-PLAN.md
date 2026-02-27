---
phase: 01-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - rms-api/package.json
  - rms-api/src/main.ts
  - rms-api/src/app.module.ts
  - rms-api/src/config/config.schema.ts
  - rms-api/src/prisma/prisma.module.ts
  - rms-api/src/prisma/prisma.service.ts
  - rms-api/.env.example
  - rms-api/prisma/schema.prisma
  - rms-api/docker-compose.yml
  - rms-api/.nvmrc
autonomous: true
requirements:
  - FOUND-01
  - FOUND-02
  - FOUND-03
  - FOUND-04
  - FOUND-05

must_haves:
  truths:
    - "The NestJS application boots without errors when DATABASE_URL and PORTAL_JWT_SECRET are set"
    - "npx prisma migrate dev runs and produces a migration file containing all Phase 1 tables (User, Branch, UserBranchRole, AuditEvent, MerpIntegrationLog)"
    - "The RmsRole enum exists in the Prisma client with all 7 roles (RETURNS_AGENT, BRANCH_MANAGER, WAREHOUSE, QC, FINANCE, ADMIN, CUSTOMER)"
    - "The UserBranchRole table has a unique constraint on (userId, branchId) — one role per user per branch"
    - "The AuditEvent table has JSONB columns oldValue and newValue, and indexes on rmaId, actorId, occurredAt"
    - "Missing required env vars cause a descriptive startup error (not a runtime crash) via Zod validation"
    - "docker-compose up starts PostgreSQL 16 and Redis 7 with a health check on Postgres"
  artifacts:
    - path: "rms-api/prisma/schema.prisma"
      provides: "Complete Phase 1 schema — User, Branch, UserBranchRole, AuditEvent, MerpIntegrationLog, RmsRole enum"
      contains: "model User, model Branch, model UserBranchRole, model AuditEvent, model MerpIntegrationLog, enum RmsRole"
    - path: "rms-api/src/config/config.schema.ts"
      provides: "Zod env validation — fails fast at startup with descriptive error for missing vars"
      exports: ["validate"]
    - path: "rms-api/src/prisma/prisma.service.ts"
      provides: "PrismaService extending PrismaClient — single DB connection for the whole app"
      exports: ["PrismaService"]
    - path: "rms-api/docker-compose.yml"
      provides: "Local dev environment — PostgreSQL 16 + Redis 7"
      contains: "postgres:16, redis:7-alpine"
  key_links:
    - from: "rms-api/src/app.module.ts"
      to: "rms-api/src/config/config.schema.ts"
      via: "ConfigModule.forRoot({ validate })"
      pattern: "validate.*config\\.schema"
    - from: "rms-api/src/app.module.ts"
      to: "rms-api/src/prisma/prisma.module.ts"
      via: "PrismaModule import (global)"
      pattern: "PrismaModule"
    - from: "rms-api/prisma/schema.prisma"
      to: "rms-api/src/prisma/prisma.service.ts"
      via: "npx prisma generate produces typed client"
      pattern: "PrismaClient"
---

<objective>
Scaffold the NestJS project, configure the local dev environment, and create the complete Phase 1 database schema. This plan delivers the substrate — everything else in Phase 1 and all subsequent phases depends on the schema and project structure being correct before auth, audit, or MERP work begins.

Purpose: Establish the infrastructure foundation — correct schema, working migrations, and a booting application — so Plans 02 and 03 can implement auth and audit/MERP in parallel without waiting on each other.

Output: A booting NestJS application with a Prisma schema containing all Phase 1 tables, a running Docker Compose environment, and Zod env validation that fails fast on misconfiguration.
</objective>

<execution_context>
@C:/Users/megan.delia/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/megan.delia/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-foundation/01-RESEARCH.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Scaffold NestJS project and install all dependencies</name>
  <files>
    rms-api/package.json
    rms-api/src/main.ts
    rms-api/.nvmrc
    rms-api/docker-compose.yml
    rms-api/.env.example
  </files>
  <action>
    Run the NestJS scaffold and install all dependencies as specified in RESEARCH.md. Work from the parent of rms-api (not inside it).

    Step 1 — Pin Node version:
    Create rms-api/.nvmrc containing exactly: `20`
    Add to rms-api/package.json engines field: `"engines": { "node": ">=20.19.0" }`
    This prevents Pitfall 5 (Prisma 7 requires Node 20.19.0+).

    Step 2 — Scaffold NestJS:
    ```bash
    npm install -g @nestjs/cli
    nest new rms-api --package-manager npm --skip-git
    ```

    Step 3 — Install auth dependencies:
    ```bash
    cd rms-api
    npm install @nestjs/jwt @nestjs/passport passport passport-jwt
    npm install @types/passport-jwt --save-dev
    ```

    Step 4 — Install ORM:
    ```bash
    npm install prisma @prisma/client
    npx prisma init
    ```

    Step 5 — Install config and logging:
    ```bash
    npm install @nestjs/config zod pino pino-http nestjs-pino
    ```

    Step 6 — Install context propagation:
    ```bash
    npm install nestjs-cls
    ```

    Step 7 — Install v2-ready dependencies (install now, activate later):
    ```bash
    npm install bullmq ioredis
    ```

    Step 8 — Create docker-compose.yml in rms-api/:
    ```yaml
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

    Step 9 — Create rms-api/.env.example (template only — real .env created manually):
    ```
    DATABASE_URL="postgresql://rms:rms_local_dev@localhost:5432/rms_dev?schema=public"
    PORTAL_JWT_SECRET="replace-with-portal-team-provided-secret"
    NODE_ENV=development
    PORT=3000
    ```

    Step 10 — Update rms-api/src/main.ts to use Pino logger and global ValidationPipe:
    ```typescript
    import { NestFactory } from '@nestjs/core';
    import { Logger } from 'nestjs-pino';
    import { ValidationPipe } from '@nestjs/common';
    import { AppModule } from './app.module';

    async function bootstrap() {
      const app = await NestFactory.create(AppModule, { bufferLogs: true });
      app.useLogger(app.get(Logger));
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
      const port = process.env.PORT ?? 3000;
      await app.listen(port);
    }
    bootstrap();
    ```

    Start Docker before running migrations in Task 2:
    ```bash
    cd rms-api && docker compose up -d
    ```
    Wait for health check (postgres must be ready). Verify with:
    ```bash
    docker compose ps
    ```
  </action>
  <verify>
    <automated>cd rms-api && node --version | grep -E "v2[0-9]\." && docker compose ps | grep "healthy"</automated>
  </verify>
  <done>Node 20+ confirmed, Docker Compose running with postgres healthy status, rms-api/package.json exists with all required dependencies listed.</done>
</task>

<task type="auto">
  <name>Task 2: Write Prisma schema and run initial migration</name>
  <files>
    rms-api/prisma/schema.prisma
    rms-api/prisma/migrations/ (generated)
  </files>
  <action>
    Replace the default prisma/schema.prisma with the full Phase 1 schema. This schema contains ONLY the cross-cutting infrastructure tables — no RMA, RmaLine, Comment, or Attachment models (those are Phase 2+).

    Write rms-api/prisma/schema.prisma:
    ```prisma
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
      portalUserId String   @unique  // portal JWT sub claim — FK from host portal
      email        String   @unique
      displayName  String
      createdAt    DateTime @default(now())
      updatedAt    DateTime @updatedAt

      branchRoles UserBranchRole[]
      auditEvents AuditEvent[]      @relation("ActorAuditEvents")
    }

    model Branch {
      id        String   @id @default(uuid())
      name      String
      code      String   @unique
      isActive  Boolean  @default(true)
      createdAt DateTime @default(now())

      branchRoles UserBranchRole[]
    }

    // Junction table: one row per (user, branch, role) assignment
    // A user can appear multiple times — once per branch they are assigned to
    model UserBranchRole {
      id         String   @id @default(uuid())
      userId     String
      branchId   String
      role       RmsRole
      assignedAt DateTime @default(now())
      assignedBy String   // portal user ID of Admin who granted this role

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

    // Append-only. Never UPDATE or DELETE rows. Written inside the same
    // $transaction() as the state change it records.
    model AuditEvent {
      id         String   @id @default(uuid())
      rmaId      String?  // nullable: non-RMA events (e.g. user provisioning)
      rmaLineId  String?  // nullable: line-level actions
      actorId    String   // FK → User
      actorRole  String   // snapshot of role at event time (string for forward-compat)
      action     String   // AuditAction constant (stored as string for flexibility)
      fromStatus String?  // RMAStatus value for state transitions
      toStatus   String?
      oldValue   Json?    // JSONB: field-level before state
      newValue   Json?    // JSONB: field-level after state
      metadata   Json?    // JSONB: flexible extra context
      ipAddress  String?
      occurredAt DateTime @default(now())

      actor User @relation("ActorAuditEvents", fields: [actorId], references: [id])

      @@index([rmaId])
      @@index([actorId])
      @@index([occurredAt])
    }

    // ─── MERP Integration Log ─────────────────────────────────────────────────────

    // Logs every call to the MERP adapter (stub or live) for reconciliation.
    model MerpIntegrationLog {
      id              String   @id @default(uuid())
      rmaId           String
      operationType   String   // 'CREDIT_MEMO' | 'REPLACEMENT_ORDER'
      requestPayload  Json     // full payload sent (or would-be sent in stub)
      responsePayload Json?    // full MERP response
      referenceId     String?  // MERP-returned reference ID
      status          String   // 'STUB' | 'SUCCESS' | 'FAILED'
      errorMessage    String?
      calledAt        DateTime @default(now())

      @@index([rmaId])
    }
    ```

    Create rms-api/.env (local dev only — do not commit):
    ```
    DATABASE_URL="postgresql://rms:rms_local_dev@localhost:5432/rms_dev?schema=public"
    PORTAL_JWT_SECRET="local-dev-secret-replace-with-portal-team-value"
    NODE_ENV=development
    PORT=3000
    ```

    Add .env to .gitignore if not already present.

    Run migration:
    ```bash
    cd rms-api && npx prisma migrate dev --name init-foundation
    ```

    Then generate the Prisma client:
    ```bash
    cd rms-api && npx prisma generate
    ```

    If migration fails because Docker postgres is not ready, wait 10 seconds and retry.
  </action>
  <verify>
    <automated>cd rms-api && npx prisma migrate status 2>&1 | grep "Database schema is up to date" && npx prisma validate</automated>
  </verify>
  <done>Migration applied, prisma validate passes with no errors, Prisma client generated. The migration file in prisma/migrations/ contains CREATE TABLE statements for User, Branch, UserBranchRole, AuditEvent, MerpIntegrationLog and the RmsRole enum.</done>
</task>

<task type="auto">
  <name>Task 3: Wire Zod env validation, PrismaModule, and root AppModule</name>
  <files>
    rms-api/src/config/config.schema.ts
    rms-api/src/prisma/prisma.module.ts
    rms-api/src/prisma/prisma.service.ts
    rms-api/src/app.module.ts
  </files>
  <action>
    Create the three infrastructure modules that every subsequent plan depends on. These are stateless wiring — no business logic.

    Step 1 — Create rms-api/src/config/config.schema.ts:
    ```typescript
    import { z } from 'zod';

    const configSchema = z.object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      PORT: z.coerce.number().int().positive().default(3000),
      DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid postgresql:// URL' }),
      PORTAL_JWT_SECRET: z.string().min(16, {
        message: 'PORTAL_JWT_SECRET must be at least 16 characters',
      }),
    });

    export type AppConfig = z.infer<typeof configSchema>;

    // Called by ConfigModule.forRoot({ validate }) — throws at startup if any var is missing or invalid
    export function validate(config: Record<string, unknown>): AppConfig {
      const result = configSchema.safeParse(config);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        throw new Error(`Configuration validation failed:\n${issues}`);
      }
      return result.data;
    }
    ```

    Step 2 — Create rms-api/src/prisma/prisma.service.ts:
    ```typescript
    import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
    import { PrismaClient } from '@prisma/client';

    @Injectable()
    export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
      async onModuleInit(): Promise<void> {
        await this.$connect();
      }

      async onModuleDestroy(): Promise<void> {
        await this.$disconnect();
      }
    }
    ```

    Step 3 — Create rms-api/src/prisma/prisma.module.ts:
    ```typescript
    import { Global, Module } from '@nestjs/common';
    import { PrismaService } from './prisma.service';

    @Global()  // Available in every module without re-importing
    @Module({
      providers: [PrismaService],
      exports: [PrismaService],
    })
    export class PrismaModule {}
    ```

    Step 4 — Replace rms-api/src/app.module.ts with the wired root module:
    ```typescript
    import { Module } from '@nestjs/common';
    import { ConfigModule } from '@nestjs/config';
    import { LoggerModule } from 'nestjs-pino';
    import { PrismaModule } from './prisma/prisma.module';
    import { validate } from './config/config.schema';

    @Module({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate,
          // Fail at startup if any required env var is missing
        }),
        LoggerModule.forRoot({
          pinoHttp: {
            transport:
              process.env.NODE_ENV !== 'production'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        }),
        PrismaModule,
        // AuthModule, AuditModule, MerpModule added in Plans 02 and 03
      ],
    })
    export class AppModule {}
    ```

    Step 5 — Verify the application boots:
    ```bash
    cd rms-api && npm run build 2>&1 | tail -5
    ```

    If build passes, start briefly and kill:
    ```bash
    cd rms-api && timeout 10 npm run start:dev 2>&1 | head -20 || true
    ```

    The output should show "NestJS application is listening" without errors. If PORTAL_JWT_SECRET is short, the Zod error will be descriptive — fix .env if needed.
  </action>
  <verify>
    <automated>cd rms-api && npm run build 2>&1 | grep -v "error TS" | tail -5 && echo "BUILD_OK"</automated>
  </verify>
  <done>TypeScript build completes with no errors. AppModule imports ConfigModule with Zod validate function, PrismaModule globally exported. Running the app with a valid .env produces no startup errors.</done>
</task>

</tasks>

<verification>
After all three tasks complete, run the following checks:

1. Migration status: `cd rms-api && npx prisma migrate status` — must show "Database schema is up to date"
2. Schema validation: `cd rms-api && npx prisma validate` — must show no errors
3. TypeScript build: `cd rms-api && npm run build` — must exit 0
4. Docker health: `cd rms-api && docker compose ps` — postgres must show "healthy"
5. Table existence (connect to DB and confirm tables exist):
   ```bash
   cd rms-api && docker compose exec postgres psql -U rms -d rms_dev -c "\dt"
   ```
   Expected output includes: User, Branch, UserBranchRole, AuditEvent, MerpIntegrationLog
6. Enum existence:
   ```bash
   cd rms-api && docker compose exec postgres psql -U rms -d rms_dev -c "\dT+"
   ```
   Expected output includes: RmsRole with 7 values
</verification>

<success_criteria>
- NestJS project exists at rms-api/ with all required npm dependencies installed
- prisma/schema.prisma defines User, Branch, UserBranchRole (with @@unique([userId, branchId])), AuditEvent (with JSONB oldValue/newValue and 3 indexes), MerpIntegrationLog, and RmsRole enum with 7 values
- npx prisma migrate status shows "up to date" — migration applied, not pending
- npm run build exits 0 with no TypeScript errors
- docker-compose.yml starts postgres:16 (port 5432) and redis:7-alpine (port 6379)
- Starting app with missing DATABASE_URL produces a clear Zod validation error message, not a cryptic crash
- .env is gitignored; .env.example is committed
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-01-SUMMARY.md` with:
- Files created and their purpose
- Any deviations from the plan and why
- Migration name and what tables it created
- Confirmation that TypeScript build passes
- Any open questions (e.g., if portal team JWT format was not yet confirmed)
</output>
