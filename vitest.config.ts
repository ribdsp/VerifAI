import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  resolve: {
    // Tests run against TypeScript source, not built output, so a failing test
    // points at a real line in `src/` instead of a bundled artifact.
    alias: {
      '@verifai/core': resolvePath('./packages/core/src/index.ts'),
      '@verifai/fingerprints': resolvePath('./packages/fingerprints/src/index.ts'),
      '@verifai/node': resolvePath('./packages/node/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // A probe suite that talks to the network by accident is a suite that
    // charges the developer money and produces flaky results. Fixtures and
    // local fake servers only - enforced, not just asked for. The setup file
    // documents what it does and does not cover.
    setupFiles: ['./test/setup/no-network.ts'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/index.ts',
        'packages/*/src/**/*.d.ts',
        // The executable's wiring of the real process - signals, TTYs, the Node
        // transport. It only runs as the built binary, which v8 cannot trace back
        // to this file; test/built-cli.test.ts runs that binary in CI instead.
        'packages/cli/src/bin.ts',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
})
