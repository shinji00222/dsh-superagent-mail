import { defineConfig } from 'vitest/config'
// Share one React instance across DSH client packages and tests.
// `pool: 'threads'` keeps test execution inside worker threads: the constrained Windows sandbox
// this repository is verified in refuses the forked child processes (and their piped stdio) that
// the default pool starts. It changes execution only, not test semantics.
export default defineConfig({ resolve: { dedupe: ['react', 'react-dom'] },
  test: { include: ['tests/**/*.spec.{ts,tsx}'], pool: 'threads' } })
