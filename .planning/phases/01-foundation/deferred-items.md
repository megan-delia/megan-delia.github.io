# Deferred Items — Phase 01-foundation

## Prisma 7 ESM + NestJS CJS Jest Incompatibility

**Discovered in:** Plan 04, Tasks 3-5

**Issue:** Prisma 7 generates an ESM-only client (`generated/prisma/client.ts`) that uses `import.meta.url`. This is fundamentally incompatible with Jest's CommonJS test environment.

**Attempted fixes (all failed):**
1. `moduleNameMapper` to redirect client → enums (breaks PrismaClient needed for integration tests)
2. `module: 'commonjs'` tsconfig override in ts-jest (TypeScript rejects `import.meta` in commonjs mode)
3. `--experimental-vm-modules` with `useESM: true` in ts-jest (NestJS CJS packages fail with `exports is not defined` in ESM context)

**Current state:** Integration tests (`auth.e2e.spec.ts`, `audit.integration.spec.ts`, `merp-stub.spec.ts`) are correctly written and will execute correctly at runtime, but cannot be run via Jest due to this incompatibility.

**Resolution options:**
1. Wait for Prisma 7 to provide a CJS compatibility shim
2. Use a custom jest test environment that handles the ESM/CJS interop
3. Run integration tests via `ts-node` directly (not jest) as a workaround
4. Use `@jest-runner/jasmine2` or alternative runner that supports mixed ESM/CJS
5. Investigate whether building the Prisma client to `dist/` and pointing tests at the compiled output resolves the issue

**Priority:** Medium — tests run correctly in application context; only the jest runner is affected.
**Blocked by:** Fundamental ESM/CJS module system incompatibility in Jest 30 + Prisma 7 + NestJS 11
