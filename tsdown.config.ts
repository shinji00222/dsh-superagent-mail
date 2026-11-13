import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: 'src/index.ts',
    outDir: 'lib',
    format: 'esm',
    target: 'es2024',
    fixedExtension: false,
    deps: { neverBundle: ['zod', 'imapflow', 'mailparser', 'google-auth-library'] },
  },
  {
    entry: { client: 'src/client.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    clean: false,
    dts: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime'] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-superagent-mail", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
