---
phase: 01-foundation
plan: 02
subsystem: auth
tags: [nestjs, passport, jwt, guards, rbac, prisma, typescript]

# Dependency graph
requires:
  - 01-foundation/01-01 (NestJS scaffold, PrismaModule @Global, generated Prisma client)
provides:
  - JwtStrategy validating portal JWT Bearer tokens against PORTAL_JWT_SECRET; attaches {portalUserId, email} to req.user
  - JwtAuthGuard (global via APP_GUARD) returning 401 on invalid/expired token — Step 1 of guard chain
  - RmsAuthGuard looking up user in user_branch_roles by portalUserId; attaches RmsUserContext to req.rmsUser; throws ForbiddenException(403) for unprovisioned users
  - RolesGuard reading @Roles() metadata; Admin bypasses; any authenticated user passes without @Roles()
  - @Roles() decorator (SetMetadata) for per-route role restriction
  - UsersService.findByPortalId() returning RmsUserContext with role/branchIds/isAdmin (null for unprovisioned)
  - branchScopeWhere() query-layer helper exported from users.service.ts
  - UsersRepository wrapping Prisma findUnique with branchRoles select
  - AuthModule, UsersModule, AppModule (updated) fully wired
affects: [03-audit-merp, all future feature plans that use auth context or branch scoping]

# Tech tracking
tech-stack:
  added:
    - "@nestjs/passport + passport + passport-jwt (activated -- JWT strategy pattern)"
    - "@nestjs/jwt (JwtModule.registerAsync with ConfigService injection)"
  patterns:
    - "Two-step guard chain: JwtAuthGuard (global APP_GUARD) validates JWT → RmsAuthGuard looks up RMS role"
    - "Roles from user_branch_roles table only — NEVER from JWT claims (locked decision)"
    - "findByPortalId() returns null (not throws) for unprovisioned users; guard converts null to 403"
    - "branchScopeWhere() returns {} for Admin (no filter), {branchId:{in:[...]}} for all other roles"
    - "resolvePrimaryRole() picks highest-priority role across all branch assignments (multi-branch capable)"
    - ".js extensions in all import paths (nodenext module resolution from Plan 01)"
    - "RmsRole imported from ../../generated/prisma/client.js (Prisma 7 pattern)"

key-files:
  created:
    - rms-api/src/auth/jwt.strategy.ts
    - rms-api/src/auth/jwt-auth.guard.ts
    - rms-api/src/auth/rms-auth.guard.ts
    - rms-api/src/auth/roles.guard.ts
    - rms-api/src/auth/roles.decorator.ts
    - rms-api/src/auth/auth.module.ts
    - rms-api/src/users/users.repository.ts
    - rms-api/src/users/users.service.ts
    - rms-api/src/users/users.module.ts
  modified:
    - rms-api/src/app.module.ts (added AuthModule, UsersModule, APP_GUARD JwtAuthGuard)

key-decisions:
  - "Roles from user_branch_roles only (LOCKED): JWT sub claim used only for identity (portalUserId), never for role assignment"
  - "JWT format: HS256 symmetric — PORTAL_JWT_SECRET is a shared secret. RS256 asymmetric NOT used. Portal team confirmation still needed if portal issues RS256 tokens"
  - "RmsRole import path: ../../generated/prisma/client.js (Prisma 7 generated client, not @prisma/client)"
  - "Multi-branch from day one: branchIds[] always an array; resolvePrimaryRole() handles multiple roles via priority table"

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 1 Plan 02: Auth Guard Chain Summary

**Two-step JWT + RMS role guard chain with @Roles() decorator and branchScopeWhere() query-layer helper — HS256 symmetric JWT (portal confirmation pending for RS256)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-27T18:21:12Z
- **Completed:** 2026-02-27T18:23:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- JwtStrategy validates Bearer token from Authorization header against PORTAL_JWT_SECRET; attaches {portalUserId, email} to req.user
- Two-step guard chain implemented: JwtAuthGuard (global) validates JWT identity; RmsAuthGuard looks up RMS role and attaches RmsUserContext to req.rmsUser
- RmsAuthGuard correctly throws ForbiddenException(403) — not 500 — when findByPortalId returns null (unprovisioned user)
- RolesGuard reads @Roles() metadata; Admin role bypasses all restrictions; no @Roles() = any authenticated user passes
- UsersService.findByPortalId() returns null (not throws) for unprovisioned users; resolvePrimaryRole() picks highest-priority role across multi-branch assignments
- branchScopeWhere() exported from users.service.ts; returns {} for Admin (global visibility), {branchId:{in:[...]}} for all other roles
- AppModule applies JwtAuthGuard globally via APP_GUARD — every endpoint is JWT-protected by default
- Full TypeScript build passes with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement JWT strategy, guards, and roles decorator** - `773de42` (feat)
2. **Task 2: Wire AppModule with global JwtAuthGuard** - `d01af66` (feat)

## Files Created/Modified

- `rms-api/src/auth/jwt.strategy.ts` — PassportStrategy('jwt') extracting Bearer token; exports PortalJwtPayload, PortalUserIdentity, JwtStrategy
- `rms-api/src/auth/jwt-auth.guard.ts` — AuthGuard('jwt') Step 1; returns 401 on invalid/expired token; exports JwtAuthGuard
- `rms-api/src/auth/rms-auth.guard.ts` — CanActivate Step 2; looks up RMS role by portalUserId; throws ForbiddenException if not provisioned; exports RmsAuthGuard
- `rms-api/src/auth/roles.decorator.ts` — @Roles() SetMetadata decorator with ROLES_KEY constant; exports Roles, ROLES_KEY
- `rms-api/src/auth/roles.guard.ts` — CanActivate reading @Roles() metadata; Admin bypasses; exports RolesGuard
- `rms-api/src/auth/auth.module.ts` — Wires PassportModule, JwtModule (async), UsersModule; exports JwtAuthGuard, RmsAuthGuard, RolesGuard, PassportModule
- `rms-api/src/users/users.repository.ts` — Prisma findUnique with branchRoles select; exports UsersRepository, UserWithBranchRoles
- `rms-api/src/users/users.service.ts` — findByPortalId() and branchScopeWhere(); exports UsersService, RmsUserContext, branchScopeWhere
- `rms-api/src/users/users.module.ts` — Exports UsersService for AuthModule injection
- `rms-api/src/app.module.ts` — Updated: imports AuthModule and UsersModule; registers JwtAuthGuard as APP_GUARD

## Decisions Made

- **Roles from database only (LOCKED):** The JWT `sub` claim is used solely for identity (becomes `portalUserId`). Role assignment always comes from the `user_branch_roles` table. This decision is locked and must not change.
- **JWT format — HS256 assumed:** PORTAL_JWT_SECRET is a symmetric shared secret. This implementation uses HS256. If the portal team issues RS256 (asymmetric) tokens, `JwtStrategy` must be updated to use a public key in `secretOrKeyProvider`. **Portal team confirmation is still needed.**
- **RmsRole import path:** `from '../../generated/prisma/client.js'` — Prisma 7 generates to `generated/prisma/` not `@prisma/client`. Consistent with PrismaService pattern from Plan 01.
- **Multi-branch from day one:** `branchIds` is always `string[]`. `resolvePrimaryRole()` handles users assigned to multiple branches by selecting the highest-priority role.

## JWT Format Note

This implementation assumes **HS256 (symmetric HMAC)** — `PORTAL_JWT_SECRET` is the shared secret used for both signing and verification. If the portal team uses **RS256 (asymmetric RSA)**, the `JwtStrategy` constructor must be updated:
```typescript
// RS256 variant — replace secretOrKey with secretOrKeyProvider + public key
secretOrKeyProvider: passportJwtSecret({
  cache: true,
  jwksUri: 'https://portal/.well-known/jwks.json',
})
```
**Action required:** Confirm JWT algorithm with portal team before Phase 5 integration testing.

## branchScopeWhere Usage

Future repository functions use this pattern for data ownership:
```typescript
import { branchScopeWhere } from '../users/users.service.js';

// In any repository method:
prisma.rma.findMany({
  where: {
    ...branchScopeWhere(rmsUser),
    // other filters
  }
})
// Admin → no branch filter (sees all branches)
// Other roles → { branchId: { in: ['branch-1', 'branch-2'] } }
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Import paths needed .js extensions for nodenext module resolution**
- **Found during:** Task 1
- **Issue:** The plan's code uses bare imports (e.g., `from '../users/users.service'`) but the project uses `"module": "nodenext"` in tsconfig.json (established in Plan 01), which requires `.js` extensions for relative imports
- **Fix:** Added `.js` extensions to all relative imports in auth and users files (e.g., `from '../users/users.service.js'`)
- **Files modified:** All auth/ and users/ files
- **Commit:** 773de42

**2. [Rule 1 - Bug] RmsRole import path corrected from @prisma/client to generated client**
- **Found during:** Task 1
- **Issue:** The plan's `users.repository.ts` and `users.service.ts` use `import { RmsRole } from '@prisma/client'` but Prisma 7 generates the client to `../generated/prisma` (not `@prisma/client`) — documented in Plan 01 decisions
- **Fix:** Changed RmsRole import to `from '../../generated/prisma/client.js'` in both users files, consistent with PrismaService import pattern
- **Files modified:** rms-api/src/users/users.repository.ts, rms-api/src/users/users.service.ts
- **Commit:** 773de42

---

**Total deviations:** 2 auto-fixed (Rule 1 bugs from nodenext import paths and Prisma 7 generated client location — both consistent with Plan 01 decisions)
**Impact on plan:** Zero functional impact. Both fixes are mechanical adaptations to the established project conventions from Plan 01. The guard logic, types, and module wiring match the plan exactly.

## Self-Check: PASSED

All critical files confirmed present:
- rms-api/src/auth/jwt.strategy.ts: FOUND
- rms-api/src/auth/jwt-auth.guard.ts: FOUND
- rms-api/src/auth/rms-auth.guard.ts: FOUND
- rms-api/src/auth/roles.guard.ts: FOUND
- rms-api/src/auth/roles.decorator.ts: FOUND
- rms-api/src/auth/auth.module.ts: FOUND
- rms-api/src/users/users.repository.ts: FOUND
- rms-api/src/users/users.service.ts: FOUND
- rms-api/src/users/users.module.ts: FOUND
- rms-api/src/app.module.ts: FOUND (modified)

All task commits confirmed:
- 773de42 (Task 1): FOUND
- d01af66 (Task 2): FOUND

TypeScript build: PASSED (0 errors)
branchScopeWhere export: FOUND at users.service.ts:41
null return for unprovisioned users: FOUND at users.service.ts:58
APP_GUARD JwtAuthGuard registration: FOUND at app.module.ts:30
