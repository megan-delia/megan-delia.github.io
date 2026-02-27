import { defineConfig } from 'vitest/config';

/**
 * Vitest config for integration and e2e tests.
 *
 * Why Vitest instead of Jest for these tests:
 *   Prisma 7 generates an ESM-only client (uses import.meta.url + dynamic
 *   imports of .mjs WASM files). Jest 30 requires --experimental-vm-modules
 *   to handle these, but that flag breaks NestJS CJS decorator packages
 *   (exports is not defined). Vitest is ESM-native and handles both correctly.
 *
 * Unit tests (branch-scope.spec.ts, etc.) continue to use Jest via
 * the jest config in package.json — they work fine with the prisma/enums shim.
 *
 * Run with: npm run test:e2e
 * Requires:
 *   1. Docker Desktop running: docker compose up -d
 *   2. DATABASE_URL in .env
 *   3. Migrations applied: npx prisma migrate deploy
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.e2e.spec.ts',
      'src/**/*.integration.spec.ts',
      'src/**/merp-stub.spec.ts',
    ],
    // reflect-metadata must be first — NestJS decorators require it
    // dotenv/config loads DATABASE_URL, PORTAL_JWT_SECRET etc.
    setupFiles: ['reflect-metadata', 'dotenv/config'],
    // Run integration/e2e tests sequentially — they share a DB
    // pool: 'forks' is the Vitest default; singleFork is not a valid option in Vitest 4
    sequence: { concurrent: false },
    pool: 'forks',
  },
});
