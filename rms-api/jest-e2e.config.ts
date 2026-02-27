import type { Config } from 'jest';

// E2E and integration test configuration.
// Covers *.e2e.spec.ts, *.integration.spec.ts, and merp-stub.spec.ts files.
//
// Run with: npm run test:e2e
// Requires:
//   1. Docker Desktop installed and running
//   2. docker compose up -d (postgres container healthy)
//   3. DATABASE_URL env var set (e.g. in .env: DATABASE_URL=postgresql://...)
//   4. npx prisma migrate deploy (migrations applied to test DB)
//
// Prisma 7 generates ESM-only client code (import.meta.url). This config
// runs tests via Node.js --experimental-vm-modules to handle ESM/CJS interop.
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.e2e.spec.ts$|.integration.spec.ts$|merp-stub.spec.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.\\.\\.?/.*)\\.js$': '$1',
  },
};

export default config;
