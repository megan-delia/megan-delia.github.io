import type { Config } from 'jest';

// E2E and integration test configuration.
// Covers *.e2e.spec.ts, *.integration.spec.ts, and merp-stub.spec.ts files.
//
// Run with: npm run test:e2e
// Requires:
//   1. Docker Desktop installed and running
//   2. docker compose up -d (postgres container healthy)
//   3. DATABASE_URL env var set in .env
//   4. npx prisma migrate deploy (migrations applied to test DB)
//
// Prisma 7 generates ESM-only client code (import.meta.url) which is
// incompatible with Jest CJS + NestJS. We work around this by:
//   1. Running Jest in CJS mode (no --experimental-vm-modules)
//   2. Mapping generated/prisma/client.js → client-cjs-shim.ts which
//      re-exports PrismaClient and enums from sub-modules that don't use
//      import.meta.url, making them CJS-safe.
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.e2e.spec.ts$|.integration.spec.ts$|merp-stub.spec.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    // Route Prisma client to CJS-safe shim (avoids import.meta.url)
    '^(.*generated/prisma/client)\\.js$': '<rootDir>/generated/prisma/client-cjs-shim',
    // Strip .js extensions from relative imports (nodenext tsconfig compatibility)
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};

export default config;
