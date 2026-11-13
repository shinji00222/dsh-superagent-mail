import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  outDir: 'lib',
  format: 'esm',
  target: 'es2024',
  fixedExtension: false,
  deps: { neverBundle: ['zod', 'imapflow', 'mailparser', 'google-auth-library'] },
})
