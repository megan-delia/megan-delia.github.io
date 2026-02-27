---
phase: 01-foundation
plan: 02
type: execute
wave: 2
depends_on:
  - "01-PLAN"
files_modified:
  - rms-api/src/auth/auth.module.ts
  - rms-api/src/auth/jwt.strategy.ts
  - rms-api/src/auth/jwt-auth.guard.ts
  - rms-api/src/auth/rms-auth.guard.ts
  - rms-api/src/auth/roles.guard.ts
  - rms-api/src/auth/roles.decorator.ts
  - rms-api/src/users/users.module.ts
  - rms-api/src/users/users.service.ts
  - rms-api/src/users/users.repository.ts
  - rms-api/src/app.module.ts
autonomous: true
requirements:
  - FOUND-01
  - FOUND-02
  - FOUND-03

must_haves:
  truths:
    - "A request with a valid portal JWT and a provisioned RMS user succeeds (guard chain passes)"
    - "A request with a valid portal JWT but no RMS user_branch_roles row returns 403 — not 500"
    - "A request with an expired or invalid portal JWT returns 401"
    - "A user at Branch A cannot access data scoped to Branch B — branchScopeWhere() returns the correct Prisma WHERE clause"
    - "Admin users get an empty WHERE clause from branchScopeWhere() — no branch filter applied"
    - "The @Roles() decorator restricts endpoints to the specified role(s) — other roles get 403"
    - "findByPortalId() returns null (not throws) when the user has no branch role assignments"
  artifacts:
    - path: "rms-api/src/auth/jwt.strategy.ts"
      provides: "PassportStrategy validating portal JWT from Authorization Bearer header; attaches {portalUserId, email} to req.user"
      exports: ["JwtStrategy"]
    - path: "rms-api/src/auth/rms-auth.guard.ts"
      provides: "CanActivate guard — looks up user in user_branch_roles by portalUserId; throws ForbiddenException if not found; attaches RmsUserContext to req.rmsUser"
      exports: ["RmsAuthGuard"]
    - path: "rms-api/src/auth/roles.guard.ts"
      provides: "CanActivate guard — reads @Roles() metadata; checks req.rmsUser.role; returns true if no @Roles() decorator (any authenticated user)"
      exports: ["RolesGuard"]
    - path: "rms-api/src/users/users.service.ts"
      provides: "findByPortalId() returning RmsUserContext with role, branchIds[], isAdmin; branchScopeWhere() helper for repository WHERE clauses"
      exports: ["UsersService", "RmsUserContext", "branchScopeWhere"]
  key_links:
    - from: "rms-api/src/auth/jwt-auth.guard.ts"
      to: "rms-api/src/auth/jwt.strategy.ts"
      via: "AuthGuard('jwt') delegates to JwtStrategy.validate()"
      pattern: "AuthGuard.*jwt"
    - from: "rms-api/src/auth/rms-auth.guard.ts"
      to: "rms-api/src/users/users.service.ts"
      via: "usersService.findByPortalId(portalUserId)"
      pattern: "findByPortalId"
    - from: "rms-api/src/app.module.ts"
      to: "rms-api/src/auth/jwt-auth.guard.ts"
      via: "APP_GUARD provider applies JwtAuthGuard globally"
      pattern: "APP_GUARD.*JwtAuthGuard"
---

<objective>
Implement the two-step authentication guard chain: JWT validation (who you are, from the portal) followed by RMS role lookup (what you can do, from the RMS database). Also implement the @Roles() decorator and data-ownership branch scoping helper.

Purpose: This is the security backbone of the entire system. Plans 02 and 03 run in parallel — this plan owns auth files; Plan 03 owns audit/MERP files. No file overlap.

Output: A working guard chain where every request is authenticated (JwtAuthGuard globally) and optionally role-restricted (@Roles() + RolesGuard per-route). The branchScopeWhere() helper enforces data-ownership at the query layer for all future repository functions.
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
<!-- Key types from Plan 01 schema — executor uses these directly -->

From rms-api/prisma/schema.prisma (generated Prisma client types):
```typescript
// RmsRole enum — 7 roles
enum RmsRole {
  RETURNS_AGENT
  BRANCH_MANAGER
  WAREHOUSE
  QC
  FINANCE
  ADMIN
  CUSTOMER
}

// UserBranchRole — junction table (one row per user+branch assignment)
model UserBranchRole {
  id         String
  userId     String
  branchId   String
  role       RmsRole
  assignedAt DateTime
  assignedBy String
}

// User — looked up by portalUserId (from JWT sub claim)
model User {
  id           String
  portalUserId String   // @unique
  email        String
  displayName  String
  branchRoles  UserBranchRole[]
}
```

From rms-api/src/prisma/prisma.service.ts:
```typescript
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy
// Available via DI in any module that imports PrismaModule (global)
```

From rms-api/src/config/config.schema.ts:
```typescript
export function validate(config: Record<string, unknown>): AppConfig
// AppConfig has: DATABASE_URL, PORTAL_JWT_SECRET, NODE_ENV, PORT
// Access PORTAL_JWT_SECRET via ConfigService.get<string>('PORTAL_JWT_SECRET')
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement JWT strategy, guards, and roles decorator</name>
  <files>
    rms-api/src/auth/jwt.strategy.ts
    rms-api/src/auth/jwt-auth.guard.ts
    rms-api/src/auth/rms-auth.guard.ts
    rms-api/src/auth/roles.guard.ts
    rms-api/src/auth/roles.decorator.ts
    rms-api/src/auth/auth.module.ts
  </files>
  <action>
    Create the auth/ directory and implement all five auth files. These implement the two-step guard pattern from RESEARCH.md exactly — do not deviate from the documented pattern.

    LOCKED DECISION: Do NOT read roles from the portal JWT. Roles come from the user_branch_roles table only.

    Create rms-api/src/auth/jwt.strategy.ts:
    ```typescript
    import { Injectable } from '@nestjs/common';
    import { PassportStrategy } from '@nestjs/passport';
    import { ExtractJwt, Strategy } from 'passport-jwt';
    import { ConfigService } from '@nestjs/config';

    export interface PortalJwtPayload {
      sub: string;   // portal user ID — becomes portalUserId
      email: string;
      iat?: number;
      exp?: number;
    }

    export interface PortalUserIdentity {
      portalUserId: string;
      email: string;
    }

    @Injectable()
    export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
      constructor(config: ConfigService) {
        super({
          jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
          ignoreExpiration: false,
          secretOrKey: config.getOrThrow<string>('PORTAL_JWT_SECRET'),
        });
      }

      // Called after signature verification. Return value is attached to req.user.
      // Does NOT look up RMS roles — that is RmsAuthGuard's job.
      async validate(payload: PortalJwtPayload): Promise<PortalUserIdentity> {
        return { portalUserId: payload.sub, email: payload.email };
      }
    }
    ```

    Create rms-api/src/auth/jwt-auth.guard.ts:
    ```typescript
    import { Injectable } from '@nestjs/common';
    import { AuthGuard } from '@nestjs/passport';

    // Step 1 of the two-step guard chain.
    // Validates the portal JWT signature and expiry.
    // Attaches { portalUserId, email } to req.user on success.
    // Returns 401 on invalid or expired token.
    @Injectable()
    export class JwtAuthGuard extends AuthGuard('jwt') {}
    ```

    Create rms-api/src/auth/rms-auth.guard.ts:
    ```typescript
    import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
    import { UsersService } from '../users/users.service';

    // Step 2 of the two-step guard chain.
    // Requires JwtAuthGuard to have already attached req.user (portalUserId).
    // Looks up the user in user_branch_roles by portalUserId.
    // Returns 403 (not 500) if user has no RMS role assignment — Pitfall 1.
    // Attaches RmsUserContext to req.rmsUser on success.
    @Injectable()
    export class RmsAuthGuard implements CanActivate {
      constructor(private readonly usersService: UsersService) {}

      async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<{
          user: { portalUserId: string; email: string };
          rmsUser?: import('../users/users.service').RmsUserContext;
        }>();

        const { portalUserId } = request.user;
        const rmsUser = await this.usersService.findByPortalId(portalUserId);

        if (!rmsUser) {
          // CRITICAL: throw ForbiddenException, not let it crash as 500 — Pitfall 1
          throw new ForbiddenException('User not provisioned in RMS — contact your administrator');
        }

        request.rmsUser = rmsUser;
        return true;
      }
    }
    ```

    Create rms-api/src/auth/roles.decorator.ts:
    ```typescript
    import { SetMetadata } from '@nestjs/common';

    export const ROLES_KEY = 'rms_roles';
    export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
    ```

    Create rms-api/src/auth/roles.guard.ts:
    ```typescript
    import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
    import { Reflector } from '@nestjs/core';
    import { ROLES_KEY } from './roles.decorator';
    import type { RmsUserContext } from '../users/users.service';

    // Applied per-controller or per-route via @UseGuards(RolesGuard) + @Roles('ADMIN').
    // If no @Roles() decorator is present, any authenticated user passes.
    // Requires RmsAuthGuard to have already attached req.rmsUser.
    @Injectable()
    export class RolesGuard implements CanActivate {
      constructor(private readonly reflector: Reflector) {}

      canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
          context.getHandler(),
          context.getClass(),
        ]);

        // No @Roles() decorator = any authenticated user
        if (!requiredRoles || requiredRoles.length === 0) return true;

        const request = context.switchToHttp().getRequest<{ rmsUser: RmsUserContext }>();
        const { rmsUser } = request;

        // Admin can access any role-restricted endpoint
        if (rmsUser.isAdmin) return true;

        return requiredRoles.includes(rmsUser.role);
      }
    }
    ```

    Create rms-api/src/auth/auth.module.ts:
    ```typescript
    import { Module } from '@nestjs/common';
    import { PassportModule } from '@nestjs/passport';
    import { JwtModule } from '@nestjs/jwt';
    import { ConfigModule, ConfigService } from '@nestjs/config';
    import { JwtStrategy } from './jwt.strategy';
    import { JwtAuthGuard } from './jwt-auth.guard';
    import { RmsAuthGuard } from './rms-auth.guard';
    import { RolesGuard } from './roles.guard';
    import { UsersModule } from '../users/users.module';

    @Module({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.registerAsync({
          imports: [ConfigModule],
          useFactory: (config: ConfigService) => ({
            secret: config.getOrThrow<string>('PORTAL_JWT_SECRET'),
            signOptions: { expiresIn: '1h' },
          }),
          inject: [ConfigService],
        }),
        UsersModule,
      ],
      providers: [JwtStrategy, JwtAuthGuard, RmsAuthGuard, RolesGuard],
      exports: [JwtAuthGuard, RmsAuthGuard, RolesGuard, PassportModule],
    })
    export class AuthModule {}
    ```
  </action>
  <verify>
    <automated>cd rms-api && npm run build 2>&1 | grep -c "error TS" | xargs -I{} test {} -eq 0 && echo "TYPES_OK"</automated>
  </verify>
  <done>All five auth files created. TypeScript build passes with no errors in any auth/ file. The guard chain is: JwtAuthGuard (global) → RmsAuthGuard (attaches rmsUser) → RolesGuard (checks @Roles() metadata).</done>
</task>

<task type="auto">
  <name>Task 2: Implement UsersService with findByPortalId and branchScopeWhere</name>
  <files>
    rms-api/src/users/users.repository.ts
    rms-api/src/users/users.service.ts
    rms-api/src/users/users.module.ts
    rms-api/src/app.module.ts
  </files>
  <action>
    Implement the users module with the RmsUserContext type, role priority resolution, and the branchScopeWhere() helper. Then wire AuthModule and UsersModule into AppModule.

    LOCKED DECISIONS:
    - findByPortalId() returns null (not throws) when no user_branch_roles rows exist — Pitfall 1 depends on this
    - branchScopeWhere() returns {} for Admin (no filter) and { branchId: { in: branchIds } } for all other roles
    - A user can be assigned to multiple branches — branchIds is always string[]

    Create rms-api/src/users/users.repository.ts:
    ```typescript
    import { Injectable } from '@nestjs/common';
    import { PrismaService } from '../prisma/prisma.service';
    import { RmsRole } from '@prisma/client';

    export interface UserWithBranchRoles {
      id: string;
      portalUserId: string;
      email: string;
      displayName: string;
      branchRoles: Array<{
        branchId: string;
        role: RmsRole;
      }>;
    }

    @Injectable()
    export class UsersRepository {
      constructor(private readonly prisma: PrismaService) {}

      async findByPortalUserId(portalUserId: string): Promise<UserWithBranchRoles | null> {
        return this.prisma.user.findUnique({
          where: { portalUserId },
          select: {
            id: true,
            portalUserId: true,
            email: true,
            displayName: true,
            branchRoles: {
              select: { branchId: true, role: true },
            },
          },
        });
      }
    }
    ```

    Create rms-api/src/users/users.service.ts:
    ```typescript
    import { Injectable } from '@nestjs/common';
    import { RmsRole } from '@prisma/client';
    import { UsersRepository } from './users.repository';

    // The resolved user context attached to req.rmsUser after the two-step guard chain.
    // Every controller that needs auth context reads from req.rmsUser.
    export interface RmsUserContext {
      id: string;
      portalUserId: string;
      email: string;
      role: RmsRole;         // highest-priority role across all branch assignments
      branchIds: string[];   // all branches this user is assigned to
      isAdmin: boolean;
    }

    // Role priority for resolving the "primary" role when a user has multiple.
    // Higher index = higher priority.
    const ROLE_PRIORITY: RmsRole[] = [
      RmsRole.CUSTOMER,
      RmsRole.WAREHOUSE,
      RmsRole.QC,
      RmsRole.FINANCE,
      RmsRole.RETURNS_AGENT,
      RmsRole.BRANCH_MANAGER,
      RmsRole.ADMIN,
    ];

    function resolvePrimaryRole(roles: RmsRole[]): RmsRole {
      // Return the highest-priority role the user holds across all branches
      return roles.reduce((highest, current) => {
        return ROLE_PRIORITY.indexOf(current) > ROLE_PRIORITY.indexOf(highest)
          ? current
          : highest;
      }, roles[0]);
    }

    // Query-layer ownership filter.
    // Returns {} for Admin (global visibility — no branch filter).
    // Returns Prisma WHERE fragment for all other roles.
    // USAGE: prisma.rma.findMany({ where: { ...branchScopeWhere(user) } })
    export function branchScopeWhere(
      user: RmsUserContext,
    ): Record<string, unknown> {
      if (user.isAdmin) return {};
      return { branchId: { in: user.branchIds } };
    }

    @Injectable()
    export class UsersService {
      constructor(private readonly usersRepository: UsersRepository) {}

      // Returns null when user has a valid portal JWT but has NOT been provisioned in RMS.
      // RmsAuthGuard converts null → ForbiddenException(403). Does NOT throw here.
      async findByPortalId(portalUserId: string): Promise<RmsUserContext | null> {
        const user = await this.usersRepository.findByPortalUserId(portalUserId);

        // No user record OR no branch role assignments → not provisioned
        if (!user || user.branchRoles.length === 0) return null;

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
    }
    ```

    Create rms-api/src/users/users.module.ts:
    ```typescript
    import { Module } from '@nestjs/common';
    import { UsersRepository } from './users.repository';
    import { UsersService } from './users.service';

    @Module({
      providers: [UsersRepository, UsersService],
      exports: [UsersService],
    })
    export class UsersModule {}
    ```

    Update rms-api/src/app.module.ts to add AuthModule and apply JwtAuthGuard globally:
    ```typescript
    import { Module } from '@nestjs/common';
    import { APP_GUARD } from '@nestjs/core';
    import { ConfigModule } from '@nestjs/config';
    import { LoggerModule } from 'nestjs-pino';
    import { PrismaModule } from './prisma/prisma.module';
    import { AuthModule } from './auth/auth.module';
    import { UsersModule } from './users/users.module';
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
        // AuditModule, MerpModule added in Plan 03
      ],
      providers: [
        // Apply JwtAuthGuard globally — every endpoint is JWT-protected by default.
        // Routes that should be public (health check) use @Public() decorator (add in later phase if needed).
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    })
    export class AppModule {}
    ```

    Verify full TypeScript build passes:
    ```bash
    cd rms-api && npm run build 2>&1 | tail -10
    ```
  </action>
  <verify>
    <automated>cd rms-api && npm run build 2>&1 | grep -c "error TS" | xargs -I{} test {} -eq 0 && echo "AUTH_MODULE_OK"</automated>
  </verify>
  <done>UsersService.findByPortalId() returns null for unprovisionied users (not throws). branchScopeWhere() is exported and returns {} for Admin, { branchId: { in: [...] } } for all other roles. AppModule applies JwtAuthGuard globally via APP_GUARD. TypeScript build passes with no errors.</done>
</task>

</tasks>

<verification>
After both tasks complete:

1. TypeScript compilation: `cd rms-api && npm run build` — must exit 0
2. Auth file structure check:
   ```bash
   ls rms-api/src/auth/ rms-api/src/users/
   ```
   Expected: jwt.strategy.ts, jwt-auth.guard.ts, rms-auth.guard.ts, roles.guard.ts, roles.decorator.ts, auth.module.ts, users.service.ts, users.repository.ts, users.module.ts
3. branchScopeWhere export check:
   ```bash
   grep -n "export function branchScopeWhere" rms-api/src/users/users.service.ts
   ```
   Must find exactly one match.
4. Null return check (Pitfall 1):
   ```bash
   grep -n "return null" rms-api/src/users/users.service.ts
   ```
   Must find the null return for unprovisionied users.
5. APP_GUARD registration:
   ```bash
   grep -n "APP_GUARD" rms-api/src/app.module.ts
   ```
   Must show JwtAuthGuard as APP_GUARD provider.
</verification>

<success_criteria>
- JwtStrategy extracts Bearer token from Authorization header, validates against PORTAL_JWT_SECRET, attaches {portalUserId, email} to req.user
- RmsAuthGuard throws ForbiddenException('User not provisioned in RMS') when findByPortalId returns null — never 500
- RolesGuard passes any authenticated user when no @Roles() decorator is present; Admin bypasses all role checks
- UsersService.findByPortalId() returns full RmsUserContext including branchIds[] array (multi-branch capable from day one)
- branchScopeWhere(user) exported from users.service.ts; returns {} for Admin, branch filter for all others
- Full TypeScript build passes with no errors
- JwtAuthGuard applied globally via APP_GUARD in AppModule
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-02-SUMMARY.md` with:
- Files created and their key exports
- Confirmation of TypeScript build passing
- Note on any JWT format assumptions made (symmetric HS256 vs RS256) — flag if portal team confirmation is still needed
- Confirmation that branchScopeWhere is exported and usable by future repository functions
</output>
