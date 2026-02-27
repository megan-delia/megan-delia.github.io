import type { Config } from 'jest';

// E2E and integration test configuration.
// Covers *.e2e.spec.ts and *.integration.spec.ts files.
// Run with: npm run test:e2e
// Requires Docker and a running postgres container (see docker-compose.yml).
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.e2e.spec.ts$|.integration.spec.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  // Map .js imports to actual .ts files (required for nodenext module resolution with ts-jest)
  moduleNameMapper: {
    '^(\\.\\.\\.?/.*)\\.js$': '$1',
  },
  modulePaths: ['<rootDir>/src/'],
};

export default config;
