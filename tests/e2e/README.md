# tests/e2e

`persona-first-request.spec.ts` runs `experiments/e2e/run.mjs` once and asserts the docs/009 item 1
evidence against the captured real model requests. It is the executable entry for the isolated
DSH-profile e2e; see [`experiments/e2e/README.md`](../../experiments/e2e/README.md) for the design,
the exact commands, what is real/test-doubled, and the Windows compatibility shims.

```powershell
pnpm build
pnpm exec vitest run tests/e2e     # E2E_SKIP=1 skips (e.g. DSH CLI not installed)
```

The spec never asserts anything the harness could have invented: it reads
`experiments/e2e/runs/<stamp>/evidence.json` and the `captures/request-*.json` files, verifying that
the Ticket audit's `sectionText` appears verbatim in the Worker Session's **first** captured request
and in no main-Session request.
