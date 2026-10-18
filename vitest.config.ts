import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'server/**/*.test.ts', 'client/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      // Plan D10: an unscoped coverage gate fails on client glue and tool
      // boilerplate and then gets ignored. Scope is EXACTLY these four paths.
      include: ['server/rules/**', 'server/fold.ts', 'server/authority.ts', 'server/log.ts'],
      thresholds: {
        lines: 90,
        // DoD §1.5 — the authority model is the security-critical path.
        'server/authority.ts': {
          lines: 100,
        },
      },
    },
  },
});